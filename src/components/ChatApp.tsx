"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  FolderGit2,
  Menu,
  Mic,
  Plus,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  AgyModel,
  ChatDetail,
  ChatSummary,
  ExecutionMode,
  MessageItem,
  StreamEventPayload,
  ToolEvent,
} from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { ChatSettingsModal } from "./ChatSettingsModal";
import { ImportModal } from "./ImportModal";

function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " Bloco de código omitido. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ChatApp() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);

  const [models, setModels] = useState<AgyModel[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingTools, setStreamingTools] = useState<ToolEvent[]>([]);

  const [autoSpeak, setAutoSpeak] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Register PWA service worker
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageId(null);
  }, []);

  const speakMessage = useCallback(
    (msg: MessageItem) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      if (speakingMessageId === msg.id) {
        stopSpeaking();
        return;
      }

      window.speechSynthesis.cancel();
      const plain = stripMarkdownForSpeech(msg.content);
      if (!plain) return;

      const utterance = new SpeechSynthesisUtterance(plain);
      utterance.lang = "pt-BR";
      utterance.rate = 1.05;

      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find((v) => v.lang.toLowerCase().startsWith("pt"));
      if (ptVoice) utterance.voice = ptVoice;

      utterance.onend = () => setSpeakingMessageId(null);
      utterance.onerror = () => setSpeakingMessageId(null);

      setSpeakingMessageId(msg.id);
      window.speechSynthesis.speak(utterance);
    },
    [speakingMessageId, stopSpeaking]
  );

  const refreshChats = useCallback(async () => {
    const res = await fetch("/api/chats");
    if (res.status === 401) {
      router.replace("/login");
      return [];
    }
    const data = (await res.json()) as { chats?: ChatSummary[] };
    const list = data.chats || [];
    setChats(list);
    return list;
  }, [router]);

  const loadChat = useCallback(
    async (chatId: string) => {
      stopSpeaking();
      const res = await fetch(`/api/chats/${chatId}`);
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { chat: ChatDetail };
      setActiveChat(data.chat);
      shouldAutoScrollRef.current = true;
    },
    [router, stopSpeaking]
  );

  // Initial load: chats + agy models & workspaces
  useEffect(() => {
    let mounted = true;
    Promise.all([
      refreshChats(),
      fetch("/api/agy/meta")
        .then((r) => (r.ok ? r.json() : { models: [], workspaces: [] }))
        .catch(() => ({ models: [], workspaces: [] })),
    ])
      .then(([list, meta]) => {
        if (!mounted) return;
        const m = meta as { models?: AgyModel[]; workspaces?: string[] };
        setModels(m.models || []);
        setWorkspaces(m.workspaces || []);
        if (list.length > 0) {
          void loadChat(list[0].id);
        }
      })
      .finally(() => {
        if (mounted) setLoadingChats(false);
      });

    return () => {
      mounted = false;
    };
  }, [refreshChats, loadChat]);

  // Smooth auto-scroll on new messages / deltas
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeChat?.messages.length, streamingContent, streamingTools.length]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 110;
  };

  const createNewChat = async (): Promise<ChatDetail | null> => {
    stopSpeaking();
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: activeChat?.model || "",
        mode: activeChat?.mode || "auto",
        workspacePath: activeChat?.workspacePath || workspaces[0] || "",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { chat: ChatDetail };
    setActiveChat(data.chat);
    await refreshChats();
    return data.chat;
  };

  const handleImportConversation = async (conversationId: string) => {
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importAgyConversationId: conversationId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { chat: ChatDetail };
    setActiveChat(data.chat);
    await refreshChats();
  };

  const handleRenameChat = async (id: string, title: string) => {
    const res = await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { chat: ChatDetail };
    if (activeChat?.id === id) setActiveChat(data.chat);
    await refreshChats();
  };

  const handleSaveSettings = async (updates: {
    model: string;
    mode: ExecutionMode;
    workspacePath: string;
  }) => {
    if (!activeChat) return;
    const res = await fetch(`/api/chats/${activeChat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { chat: ChatDetail };
    setActiveChat(data.chat);
    await refreshChats();
  };

  const handleDeleteChat = async (id: string) => {
    const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    const updatedList = await refreshChats();
    if (activeChat?.id === id) {
      if (updatedList.length > 0) {
        await loadChat(updatedList[0].id);
      } else {
        setActiveChat(null);
      }
    }
  };

  const handleLogout = async () => {
    stopSpeaking();
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const handleStopStream = async () => {
    abortControllerRef.current?.abort();
    if (activeChat) {
      await fetch(`/api/chats/${activeChat.id}/abort`, { method: "POST" }).catch(
        () => {}
      );
    }
  };

  const handleSendMessage = async ({
    text,
    audio,
    images,
  }: {
    text: string;
    audio?: { blob: Blob; durationSec: number };
    images: File[];
  }) => {
    stopSpeaking();
    let targetChat = activeChat;
    if (!targetChat) {
      targetChat = await createNewChat();
      if (!targetChat) return;
    }

    const formData = new FormData();
    formData.append("text", text);
    if (audio) {
      const ext = audio.blob.type.includes("mp4")
        ? "m4a"
        : audio.blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      formData.append("audio", audio.blob, `voice.${ext}`);
      formData.append("audioDuration", String(audio.durationSec));
    }
    for (const img of images) {
      formData.append("images", img);
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingTools([]);
    shouldAutoScrollRef.current = true;

    try {
      const res = await fetch(`/api/chats/${targetChat.id}/messages`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (res.status === 401) {
        router.replace("/login");
        return;
      }

      if (!res.ok || !res.body) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || "Falha ao enviar mensagem.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const line = frame
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!line) continue;

          try {
            const evt = JSON.parse(line.slice(6)) as StreamEventPayload;

            if (evt.type === "user_message") {
              setActiveChat((prev) =>
                prev
                  ? { ...prev, messages: [...prev.messages, evt.message] }
                  : prev
              );
            } else if (evt.type === "init") {
              setActiveChat((prev) =>
                prev
                  ? { ...prev, agyConversationId: evt.conversationId }
                  : prev
              );
            } else if (evt.type === "delta") {
              setStreamingContent((prev) => prev + evt.text);
            } else if (evt.type === "tool") {
              setStreamingTools((prev) => {
                const idx = prev.findIndex((t) => t.stepIndex === evt.tool.stepIndex);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = evt.tool;
                  return next;
                }
                return [...prev, evt.tool];
              });
            } else if (evt.type === "done") {
              setActiveChat((prev) =>
                prev
                  ? {
                      ...prev,
                      title: evt.title || prev.title,
                      agyConversationId:
                        evt.agyConversationId || prev.agyConversationId,
                      messages: [...prev.messages, evt.message],
                    }
                  : prev
              );
              setStreamingContent("");
              setStreamingTools([]);
              if (autoSpeak) {
                speakMessage(evt.message);
              }
              void refreshChats();
            } else if (evt.type === "error") {
              if (evt.message) {
                setActiveChat((prev) =>
                  prev
                    ? { ...prev, messages: [...prev.messages, evt.message!] }
                    : prev
                );
              }
              setStreamingContent("");
              setStreamingTools([]);
            }
          } catch {
            // ignore malformed frame
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "Erro de conexão.";
        setActiveChat((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    id: `err-${Date.now()}`,
                    chatId: prev.id,
                    role: "error",
                    content: msg,
                    attachments: [],
                    toolEvents: [],
                    usage: null,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : prev
        );
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingTools([]);
      abortControllerRef.current = null;
      void refreshChats();
    }
  };

  const folderLabel = activeChat
    ? activeChat.workspacePath.split("/").filter(Boolean).pop() || "repos"
    : "";

  const modelLabel =
    models.find((m) => m.slug === activeChat?.model)?.label ||
    (activeChat?.model ? activeChat.model : "Gemini Padrão");

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#090d16] text-slate-100">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        chats={chats}
        activeChatId={activeChat?.id ?? null}
        onSelectChat={(id) => void loadChat(id)}
        onNewChat={() => void createNewChat()}
        onOpenImport={() => setImportOpen(true)}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        onLogout={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-[#0b101c]/95 px-3 pt-[max(0.65rem,env(safe-area-inset-top))] pb-2.5 backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-slate-800 lg:hidden"
              aria-label="Abrir conversas"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-white">
                {activeChat ? activeChat.title : "Gemini Mobile Bridge"}
              </h1>
              {activeChat && (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="truncate">{modelLabel}</span>
                  <span>·</span>
                  <span className="flex items-center gap-0.5 truncate text-sky-400/90">
                    <FolderGit2 className="h-3 w-3 shrink-0" />
                    {folderLabel}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Auto-speak TTS toggle */}
            <button
              type="button"
              onClick={() => {
                if (autoSpeak) stopSpeaking();
                setAutoSpeak((v) => !v);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                autoSpeak
                  ? "bg-indigo-500/25 text-indigo-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
              title={
                autoSpeak
                  ? "Leitura automática ligada (toque para desligar)"
                  : "Ativar leitura automática das respostas em voz"
              }
              aria-label="Alternar leitura automática em voz"
            >
              {autoSpeak ? (
                <Volume2 className="h-[18px] w-[18px]" />
              ) : (
                <VolumeX className="h-[18px] w-[18px]" />
              )}
            </button>

            {activeChat && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                title="Configurações do chat (modelo, pasta, modo)"
                aria-label="Configurações do chat"
              >
                <Settings2 className="h-[18px] w-[18px]" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void createNewChat()}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-slate-800 hover:text-white"
              title="Novo chat"
              aria-label="Novo chat"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Messages viewport */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        >
          <div className="mx-auto max-w-3xl space-y-4">
            {loadingChats ? (
              <div className="py-20 text-center text-sm text-slate-500">
                Carregando conversas...
              </div>
            ) : !activeChat || activeChat.messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500 shadow-xl shadow-indigo-500/20">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-lg font-semibold text-white">
                  Converse com seu Gemini local
                </h2>
                <p className="mt-2 max-w-sm text-sm text-slate-400">
                  Envie texto, grave uma mensagem de voz nativa ou mande fotos direto
                  para o <code className="text-sky-300">agy</code> rodando no seu PC.
                </p>

                <div className="mt-6 grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3 text-left">
                    <Mic className="mb-1.5 h-4 w-4 text-indigo-400" />
                    <div className="text-xs font-semibold text-slate-200">
                      Áudio nativo
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Fale naturalmente e ouça as respostas
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3 text-left">
                    <Camera className="mb-1.5 h-4 w-4 text-sky-400" />
                    <div className="text-xs font-semibold text-slate-200">
                      Câmera e fotos
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Envie prints, erros ou documentos
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-[#111827]/80 p-3 text-left">
                    <FolderGit2 className="mb-1.5 h-4 w-4 text-emerald-400" />
                    <div className="text-xs font-semibold text-slate-200">
                      Seus repositórios
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      Continua sessões reais do PC
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              activeChat.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isSpeaking={speakingMessageId === msg.id}
                  onToggleSpeak={speakMessage}
                />
              ))
            )}

            {/* Live streaming assistant bubble */}
            {isStreaming && (
              <MessageBubble
                isStreaming
                message={{
                  id: "streaming-temp",
                  chatId: activeChat?.id || "",
                  role: "assistant",
                  content: streamingContent,
                  attachments: [],
                  toolEvents: streamingTools,
                  usage: null,
                  createdAt: new Date().toISOString(),
                }}
              />
            )}

            <div ref={messagesEndRef} className="h-2" />
          </div>
        </div>

        {/* Bottom mobile composer */}
        <Composer
          disabled={loadingChats}
          isStreaming={isStreaming}
          onStop={() => void handleStopStream()}
          onSend={handleSendMessage}
        />
      </div>

      {/* Modals */}
      {settingsOpen && activeChat && (
        <ChatSettingsModal
          chat={activeChat}
          models={models}
          workspaces={workspaces}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImport={handleImportConversation}
          onSelectExisting={(chatId) => void loadChat(chatId)}
        />
      )}
    </div>
  );
}
