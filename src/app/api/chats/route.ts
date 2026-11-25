import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeChatDetail, serializeChatSummary } from "@/lib/serializers";
import { readLocalTranscriptMessages } from "@/lib/agy";
import type { ExecutionMode } from "@/lib/types";

const ALLOWED_MODES: ExecutionMode[] = ["auto", "plan", "accept-edits", "dangerous"];

export async function GET() {
  const chats = await prisma.chat.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    chats: chats.map(serializeChatSummary),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      model?: string;
      mode?: string;
      workspacePath?: string;
      importAgyConversationId?: string;
    };

    const mode: ExecutionMode = ALLOWED_MODES.includes(body.mode as ExecutionMode)
      ? (body.mode as ExecutionMode)
      : "auto";
    const workspacePath =
      body.workspacePath?.trim() || process.env.WORKSPACES_ROOT || process.cwd();
    const model = body.model?.trim() || "";

    // Import an existing local PC agy conversation if requested
    if (body.importAgyConversationId) {
      const agyId = body.importAgyConversationId.trim();
      const existing = await prisma.chat.findFirst({
        where: { agyConversationId: agyId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (existing) {
        return NextResponse.json({ chat: serializeChatDetail(existing) });
      }

      const transcriptMessages = await readLocalTranscriptMessages(agyId);
      const firstUser = transcriptMessages.find((m) => m.role === "user")?.content || "";
      const title =
        body.title?.trim() ||
        (firstUser ? firstUser.slice(0, 56) : `Chat PC ${agyId.slice(0, 8)}`);

      const created = await prisma.chat.create({
        data: {
          title,
          agyConversationId: agyId,
          model,
          mode,
          workspacePath,
          messages: {
            create: transcriptMessages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            })),
          },
        },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });

      return NextResponse.json({ chat: serializeChatDetail(created) }, { status: 201 });
    }

    const chat = await prisma.chat.create({
      data: {
        title: body.title?.trim() || "Novo chat",
        model,
        mode,
        workspacePath,
      },
      include: { messages: true },
    });

    return NextResponse.json({ chat: serializeChatDetail(chat) }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao criar chat";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
