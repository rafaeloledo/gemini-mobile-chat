import { prisma } from "@/lib/db";
import { serializeMessage } from "@/lib/serializers";
import { saveUploadedFile } from "@/lib/uploads";
import { buildPromptWithAttachments, runAgyStream } from "@/lib/agy";
import type {
  Attachment,
  ExecutionMode,
  StreamEventPayload,
  ToolEvent,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseChunk(payload: StreamEventPayload): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function generateTitleFromInput(text: string, attachments: Attachment[]): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean) {
    return clean.length > 52 ? `${clean.slice(0, 52)}…` : clean;
  }
  if (attachments.some((a) => a.type === "audio")) {
    return `Áudio (${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`;
  }
  if (attachments.some((a) => a.type === "image")) {
    return `Imagem (${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`;
  }
  return "Novo chat";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: chatId } = await context.params;
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) {
    return new Response(JSON.stringify({ error: "Chat não encontrado" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let text = "";
  const attachments: Attachment[] = [];

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      text = String(form.get("text") || "").trim();

      const audioFile = form.get("audio");
      const rawDuration = Number(form.get("audioDuration") || 0);
      const audioDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : undefined;

      if (audioFile instanceof File && audioFile.size > 0) {
        const savedAudio = await saveUploadedFile(chatId, audioFile, "audio", audioDuration);
        attachments.push(savedAudio);
      }

      const imageEntries = form.getAll("images");
      for (const entry of imageEntries) {
        if (entry instanceof File && entry.size > 0) {
          const savedImage = await saveUploadedFile(chatId, entry, "image");
          attachments.push(savedImage);
        }
      }
    } else {
      const body = (await request.json()) as { text?: string };
      text = (body.text || "").trim();
    }
  } catch {
    return new Response(JSON.stringify({ error: "Erro ao ler os dados enviados" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!text && attachments.length === 0) {
    return new Response(
      JSON.stringify({ error: "Envie um texto, áudio ou imagem." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Persist user message immediately
  const userMessageRecord = await prisma.message.create({
    data: {
      chatId,
      role: "user",
      content: text,
      attachments: JSON.stringify(attachments),
    },
  });

  // Auto-title chat on first message if still default
  let updatedTitle: string | undefined;
  if (chat.title === "Novo chat") {
    updatedTitle = generateTitleFromInput(text, attachments);
    await prisma.chat.update({
      where: { id: chatId },
      data: { title: updatedTitle, updatedAt: new Date() },
    });
  } else {
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });
  }

  const promptForAgy = buildPromptWithAttachments(text, attachments);
  const abortController = new AbortController();

  request.signal.addEventListener("abort", () => {
    abortController.abort();
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: StreamEventPayload) => {
        if (closed) return;
        try {
          controller.enqueue(sseChunk(payload));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      // Immediately emit saved user message
      send({ type: "user_message", message: serializeMessage(userMessageRecord) });

      const toolEventsMap = new Map<number, ToolEvent>();
      let savedConversationId = chat.agyConversationId || "";
      let finished = false;

      await runAgyStream({
        chatId,
        prompt: promptForAgy,
        agyConversationId: chat.agyConversationId,
        model: chat.model || undefined,
        mode: (chat.mode as ExecutionMode) || "auto",
        workspacePath: chat.workspacePath,
        signal: abortController.signal,
        onInit: async (conversationId, cwd) => {
          savedConversationId = conversationId;
          send({ type: "init", conversationId, cwd });
          if (conversationId && conversationId !== chat.agyConversationId) {
            await prisma.chat
              .update({
                where: { id: chatId },
                data: { agyConversationId: conversationId },
              })
              .catch(() => {});
          }
        },
        onDelta: (deltaText) => {
          send({ type: "delta", text: deltaText });
        },
        onTool: (tool) => {
          toolEventsMap.set(tool.stepIndex, tool);
          send({ type: "tool", tool });
        },
        onResult: async ({ conversationId, response, usage }) => {
          if (finished) return;
          finished = true;
          const finalCid = conversationId || savedConversationId;
          const tools = Array.from(toolEventsMap.values()).sort(
            (a, b) => a.stepIndex - b.stepIndex
          );

          const assistantRecord = await prisma.message.create({
            data: {
              chatId,
              role: "assistant",
              content: response.trim() || "(Sem conteúdo de texto retornado)",
              toolEvents: JSON.stringify(tools),
              usage: usage ? JSON.stringify(usage) : null,
            },
          });

          await prisma.chat
            .update({
              where: { id: chatId },
              data: {
                agyConversationId: finalCid || chat.agyConversationId,
                updatedAt: new Date(),
              },
            })
            .catch(() => {});

          send({
            type: "done",
            message: serializeMessage(assistantRecord),
            title: updatedTitle,
            agyConversationId: finalCid || undefined,
          });
          close();
        },
        onError: async (errorMsg) => {
          if (finished) return;
          finished = true;
          const tools = Array.from(toolEventsMap.values()).sort(
            (a, b) => a.stepIndex - b.stepIndex
          );
          const errorRecord = await prisma.message.create({
            data: {
              chatId,
              role: "error",
              content: errorMsg,
              toolEvents: JSON.stringify(tools),
            },
          });
          send({
            type: "error",
            error: errorMsg,
            message: serializeMessage(errorRecord),
          });
          close();
        },
      });

      close();
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
