import type { Chat, Message } from "@prisma/client";
import type {
  Attachment,
  ChatDetail,
  ChatSummary,
  ExecutionMode,
  MessageItem,
  ToolEvent,
  UsageStats,
} from "./types";

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function serializeMessage(msg: Message): MessageItem {
  const attachments = safeParseJson<Attachment[]>(msg.attachments, []).map((a) => ({
    id: a.id,
    type: a.type,
    url: a.url,
    mimeType: a.mimeType,
    filename: a.filename,
    sizeBytes: a.sizeBytes,
    durationSec: a.durationSec,
  }));

  return {
    id: msg.id,
    chatId: msg.chatId,
    role: (msg.role as MessageItem["role"]) || "assistant",
    content: msg.content,
    attachments,
    toolEvents: safeParseJson<ToolEvent[]>(msg.toolEvents, []),
    usage: safeParseJson<UsageStats | null>(msg.usage, null),
    createdAt: msg.createdAt.toISOString(),
  };
}

export function serializeChatSummary(
  chat: Chat & { messages?: Message[]; _count?: { messages: number } }
): ChatSummary {
  const lastMsg = chat.messages?.[0];
  let lastMessagePreview = "";
  if (lastMsg) {
    if (lastMsg.content.trim()) {
      lastMessagePreview = lastMsg.content.trim().slice(0, 90);
    } else {
      const atts = safeParseJson<Attachment[]>(lastMsg.attachments, []);
      if (atts.some((a) => a.type === "audio")) {
        lastMessagePreview = "🎤 Mensagem de voz";
      } else if (atts.some((a) => a.type === "image")) {
        lastMessagePreview = "📷 Imagem";
      }
    }
  }

  return {
    id: chat.id,
    title: chat.title,
    agyConversationId: chat.agyConversationId,
    model: chat.model,
    mode: (chat.mode as ExecutionMode) || "auto",
    workspacePath: chat.workspacePath,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    lastMessagePreview,
    messageCount: chat._count?.messages ?? chat.messages?.length ?? 0,
  };
}

export function serializeChatDetail(chat: Chat & { messages: Message[] }): ChatDetail {
  return {
    id: chat.id,
    title: chat.title,
    agyConversationId: chat.agyConversationId,
    model: chat.model,
    mode: (chat.mode as ExecutionMode) || "auto",
    workspacePath: chat.workspacePath,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    messages: chat.messages.map(serializeMessage),
  };
}
