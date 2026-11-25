import { spawn, execFile, type ChildProcess } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import os from "os";
import readline from "readline";
import type {
  AgyModel,
  Attachment,
  ExecutionMode,
  LocalAgyConversation,
  ToolEvent,
  UsageStats,
} from "./types";
import { getUploadsRoot } from "./uploads";

const execFileAsync = promisify(execFile);

const AGY_BIN = process.env.AGY_BIN || "agy";
const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || process.cwd();
const AGY_BRAIN_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");

// Keep active processes per chat in globalThis so hot-reload / API routes share them
const globalForRuns = globalThis as unknown as {
  activeAgyRuns?: Map<string, ChildProcess>;
  modelsCache?: { models: AgyModel[]; fetchedAt: number };
};

const activeRuns = (globalForRuns.activeAgyRuns ??= new Map<string, ChildProcess>());

export function abortChatRun(chatId: string): boolean {
  const proc = activeRuns.get(chatId);
  if (!proc) return false;
  try {
    proc.kill("SIGINT");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 2000);
  } catch {
    // ignore
  }
  activeRuns.delete(chatId);
  return true;
}

export function isChatRunning(chatId: string): boolean {
  return activeRuns.has(chatId);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;?]*[a-zA-Z]|\r/g, "");
}

export async function listAgyModels(): Promise<AgyModel[]> {
  const cache = globalForRuns.modelsCache;
  if (cache && Date.now() - cache.fetchedAt < 5 * 60 * 1000) {
    return cache.models;
  }

  try {
    const { stdout } = await execFileAsync(AGY_BIN, ["models"], { timeout: 15_000 });
    const lines = stdout
      .split("\n")
      .map((rawLine) => {
        // Take text after the last carriage return (spinner updates overwrite via \r)
        const afterCr = rawLine.split("\r").pop() || "";
        return stripAnsi(afterCr).trim();
      })
      .filter((l) => l && !l.includes("Fetching available models"));

    const models: AgyModel[] = [];
    for (const line of lines) {
      const cleaned = line.replace(/^[^a-zA-Z0-9]+/, "");
      const match = cleaned.match(/^([a-z0-9._-]+)(?:\t+|\s{2,})(.+)$/i);
      if (match) {
        models.push({ slug: match[1].trim(), label: match[2].trim() });
      }
    }

    if (models.length > 0) {
      globalForRuns.modelsCache = { models, fetchedAt: Date.now() };
      return models;
    }
  } catch {
    // Fall back to curated defaults
  }

  return [
    { slug: "", label: "Padrão do agy CLI" },
    { slug: "gemini-4-neon-high", label: "Gemini 4 Neon (High)" },
    { slug: "gemini-4-neon-medium", label: "Gemini 4 Neon (Medium)" },
    { slug: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { slug: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
  ];
}

export async function listWorkspaces(): Promise<string[]> {
  const dirs = [WORKSPACES_ROOT];
  try {
    const entries = await fs.readdir(WORKSPACES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        dirs.push(path.join(WORKSPACES_ROOT, entry.name));
      }
    }
  } catch {
    // ignore if root doesn't exist
  }
  return dirs;
}

export async function listLocalAgyConversations(
  existingByAgyId: Map<string, string>
): Promise<LocalAgyConversation[]> {
  try {
    const entries = await fs.readdir(AGY_BRAIN_DIR, { withFileTypes: true });
    const results: LocalAgyConversation[] = [];

    const candidates = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && /^[0-9a-f-]{36}$/i.test(e.name))
        .map(async (e) => {
          const transcriptPath = path.join(
            AGY_BRAIN_DIR,
            e.name,
            ".system_generated",
            "logs",
            "transcript.jsonl"
          );
          try {
            const stat = await fs.stat(transcriptPath);
            return { id: e.name, transcriptPath, mtimeMs: stat.mtimeMs };
          } catch {
            return null;
          }
        })
    );

    const valid = candidates
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 30);

    for (const item of valid) {
      try {
        const raw = await fs.readFile(item.transcriptPath, "utf8");
        const lines = raw.split("\n").filter(Boolean);
        let preview = "";
        let messageCount = 0;

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as {
              type?: string;
              source?: string;
              content?: string;
            };
            if (parsed.type === "USER_INPUT" && parsed.content) {
              messageCount++;
              if (!preview) {
                const cleaned = parsed.content
                  .replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, "")
                  .trim();
                preview = cleaned.slice(0, 120);
              }
            } else if (parsed.type === "PLANNER_RESPONSE" && parsed.content?.trim()) {
              messageCount++;
            }
          } catch {
            // skip bad line
          }
        }

        if (messageCount > 0) {
          results.push({
            conversationId: item.id,
            preview: preview || `Conversa ${item.id.slice(0, 8)}`,
            updatedAt: new Date(item.mtimeMs).toISOString(),
            messageCount,
            alreadyImportedChatId: existingByAgyId.get(item.id) ?? null,
          });
        }
      } catch {
        // skip unreadable transcript
      }
    }

    return results;
  } catch {
    return [];
  }
}

export async function readLocalTranscriptMessages(
  conversationId: string
): Promise<Array<{ role: "user" | "assistant"; content: string; createdAt?: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return [];
  const transcriptPath = path.join(
    AGY_BRAIN_DIR,
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl"
  );
  const messages: Array<{ role: "user" | "assistant"; content: string; createdAt?: string }> = [];
  try {
    const raw = await fs.readFile(transcriptPath, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line) as {
          type?: string;
          content?: string;
          created_at?: string;
        };
        if (step.type === "USER_INPUT" && step.content?.trim()) {
          const text = step.content
            .replace(/<USER_REQUEST>|<\/USER_REQUEST>/g, "")
            .trim();
          if (text) {
            messages.push({ role: "user", content: text, createdAt: step.created_at });
          }
        } else if (step.type === "PLANNER_RESPONSE" && step.content?.trim()) {
          messages.push({
            role: "assistant",
            content: step.content.trim(),
            createdAt: step.created_at,
          });
        }
      } catch {
        // ignore malformed line
      }
    }
  } catch {
    // ignore missing file
  }
  return messages;
}

export function buildPromptWithAttachments(text: string, attachments: Attachment[]): string {
  const parts: string[] = [];
  const audios = attachments.filter((a) => a.type === "audio" && a.absPath);
  const images = attachments.filter((a) => a.type === "image" && a.absPath);

  if (audios.length > 0) {
    const audioList = audios.map((a) => `- ${a.absPath}`).join("\n");
    parts.push(
      `[Mensagem de voz enviada pelo usuário pelo celular]\n` +
        `Use a ferramenta read_file/view_file para ouvir e entender o(s) arquivo(s) de áudio abaixo e responda diretamente ao que o usuário disse (no mesmo idioma em que ele falou):\n${audioList}`
    );
  }

  if (images.length > 0) {
    const imgList = images.map((a) => `- ${a.absPath}`).join("\n");
    parts.push(
      `[Imagem(ns) anexada(s) pelo usuário]\n` +
        `Use a ferramenta read_file/view_file para visualizar a(s) imagem(ns) abaixo:\n${imgList}`
    );
  }

  if (text.trim()) {
    parts.push(text.trim());
  } else if (audios.length > 0 && images.length === 0) {
    parts.push("Ouça o áudio acima e responda ao meu pedido.");
  } else if (images.length > 0 && audios.length === 0) {
    parts.push("Analise a(s) imagem(ns) anexada(s) acima e me diga o que você vê.");
  }

  return parts.join("\n\n");
}

function summarizeToolCall(
  toolName: string,
  params?: Record<string, unknown>
): string | undefined {
  if (!params) return undefined;
  const cmd = params.CommandLine || params.command;
  if (typeof cmd === "string") return cmd.slice(0, 100);
  const targetPath = params.Path || params.path || params.AbsolutePath || params.DirectoryPath;
  if (typeof targetPath === "string") return path.basename(targetPath);
  const query = params.Query || params.query || params.Pattern;
  if (typeof query === "string") return query.slice(0, 80);
  return toolName;
}

export interface StreamAgyOptions {
  chatId: string;
  prompt: string;
  agyConversationId?: string | null;
  model?: string;
  mode?: ExecutionMode;
  workspacePath?: string;
  signal?: AbortSignal;
  onInit?: (conversationId: string, cwd?: string) => void;
  onDelta?: (text: string) => void;
  onTool?: (tool: ToolEvent) => void;
  onResult?: (data: {
    conversationId: string;
    response: string;
    status: string;
    error?: string;
    usage?: UsageStats;
  }) => void;
  onError?: (errorMessage: string) => void;
}

export async function runAgyStream(opts: StreamAgyOptions): Promise<void> {
  // Abort any previous in-flight run for this chat
  abortChatRun(opts.chatId);

  const args: string[] = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--add-dir",
    getUploadsRoot(),
  ];

  if (opts.agyConversationId) {
    args.push("--conversation", opts.agyConversationId);
  }

  if (opts.model && opts.model.trim()) {
    args.push("--model", opts.model.trim());
  }

  if (opts.mode === "dangerous") {
    args.push("--dangerously-skip-permissions");
  } else if (opts.mode === "plan" || opts.mode === "auto" || opts.mode === "accept-edits") {
    args.push("--mode", opts.mode);
  }

  let cwd = opts.workspacePath || WORKSPACES_ROOT;
  try {
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) cwd = WORKSPACES_ROOT;
  } catch {
    cwd = process.cwd();
  }

  return new Promise<void>((resolve) => {
    const child = spawn(AGY_BIN, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    activeRuns.set(opts.chatId, child);

    let stderrBuf = "";
    let gotResult = false;
    let accumulatedText = "";
    let conversationId = opts.agyConversationId || "";

    const handleAbort = () => {
      abortChatRun(opts.chatId);
    };
    opts.signal?.addEventListener("abort", handleAbort, { once: true });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) return;
      try {
        const evt = JSON.parse(trimmed) as {
          event?: string;
          conversation_id?: string;
          init?: { cwd?: string };
          step_update?: {
            conversation_id?: string;
            step_index?: number;
            state?: "ACTIVE" | "DONE";
            step_type?: string;
            tool_name?: string;
            text_delta?: string;
            duration_seconds?: number;
            tool_info?: {
              name?: string;
              parameters?: Record<string, unknown>;
              error?: { message?: string };
            };
          };
          result?: {
            conversation_id?: string;
            status?: string;
            response?: string;
            error?: string;
            duration_seconds?: number;
            usage?: UsageStats;
          };
        };

        if (evt.event === "init") {
          conversationId = evt.conversation_id || conversationId;
          if (conversationId) {
            opts.onInit?.(conversationId, evt.init?.cwd);
          }
        } else if (evt.event === "step_update" && evt.step_update) {
          const su = evt.step_update;
          if (su.conversation_id) conversationId = su.conversation_id;

          if (su.step_type === "agent_response" && typeof su.text_delta === "string" && su.text_delta.length > 0) {
            accumulatedText += su.text_delta;
            opts.onDelta?.(su.text_delta);
          } else if (su.step_type === "tool") {
            const toolName = su.tool_name || su.tool_info?.name || "tool";
            opts.onTool?.({
              stepIndex: su.step_index ?? 0,
              toolName,
              state: su.state === "DONE" ? "DONE" : "ACTIVE",
              summary: summarizeToolCall(toolName, su.tool_info?.parameters),
              durationSeconds: su.duration_seconds,
              error: su.tool_info?.error?.message,
            });
          }
        } else if (evt.event === "result" && evt.result) {
          gotResult = true;
          const res = evt.result;
          const finalCid = res.conversation_id || conversationId;
          const finalResponse = res.response || accumulatedText;
          const usage: UsageStats | undefined = res.usage
            ? { ...res.usage, duration_seconds: res.duration_seconds }
            : res.duration_seconds
              ? { duration_seconds: res.duration_seconds }
              : undefined;

          if (res.status && res.status !== "SUCCESS" && res.error) {
            opts.onError?.(res.error);
          } else {
            opts.onResult?.({
              conversationId: finalCid,
              response: finalResponse,
              status: res.status || "SUCCESS",
              error: res.error,
              usage,
            });
          }
        }
      } catch {
        // Ignore non-JSON diagnostic lines
      }
    });

    child.on("error", (err) => {
      activeRuns.delete(opts.chatId);
      opts.signal?.removeEventListener("abort", handleAbort);
      opts.onError?.(`Falha ao iniciar o CLI agy (${AGY_BIN}): ${err.message}`);
      resolve();
    });

    child.on("close", (code, signal) => {
      activeRuns.delete(opts.chatId);
      opts.signal?.removeEventListener("abort", handleAbort);
      rl.close();

      if (!gotResult) {
        if (signal === "SIGINT" || signal === "SIGKILL" || opts.signal?.aborted) {
          if (accumulatedText.trim()) {
            opts.onResult?.({
              conversationId,
              response: `${accumulatedText.trim()}\n\n_[Geração interrompida]_`,
              status: "INTERRUPTED",
            });
          } else {
            opts.onError?.("Geração interrompida pelo usuário.");
          }
        } else if (code !== 0) {
          const detail = stripAnsi(stderrBuf).trim().slice(0, 600);
          opts.onError?.(
            detail || `O processo agy encerrou com código ${code ?? "desconhecido"}.`
          );
        } else if (accumulatedText) {
          opts.onResult?.({
            conversationId,
            response: accumulatedText,
            status: "SUCCESS",
          });
        } else {
          opts.onError?.("O agy encerrou sem retornar resposta.");
        }
      }
      resolve();
    });
  });
}
