export type ExecutionMode = "auto" | "plan" | "accept-edits" | "dangerous";

export interface Attachment {
  id: string;
  type: "audio" | "image";
  url: string;
  absPath?: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  durationSec?: number;
}

export interface ToolEvent {
  stepIndex: number;
  toolName: string;
  state: "ACTIVE" | "DONE";
  summary?: string;
  durationSeconds?: number;
  error?: string;
}

export interface UsageStats {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
  duration_seconds?: number;
}

export interface MessageItem {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "error";
  content: string;
  attachments: Attachment[];
  toolEvents: ToolEvent[];
  usage: UsageStats | null;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  agyConversationId: string | null;
  model: string;
  mode: ExecutionMode;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string;
  messageCount?: number;
}

export interface ChatDetail extends ChatSummary {
  messages: MessageItem[];
}

export interface AgyModel {
  slug: string;
  label: string;
}

export interface LocalAgyConversation {
  conversationId: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
  alreadyImportedChatId: string | null;
}

export type StreamEventPayload =
  | { type: "user_message"; message: MessageItem }
  | { type: "init"; conversationId: string; cwd?: string }
  | { type: "delta"; text: string }
  | { type: "tool"; tool: ToolEvent }
  | { type: "done"; message: MessageItem; title?: string; agyConversationId?: string }
  | { type: "error"; error: string; message?: MessageItem };
