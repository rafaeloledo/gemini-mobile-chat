"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, Terminal, X } from "lucide-react";
import type { LocalAgyConversation } from "@/lib/types";

interface ImportModalProps {
  onClose: () => void;
  onImport: (conversationId: string) => Promise<void>;
  onSelectExisting: (chatId: string) => void;
}

export function ImportModal({
  onClose,
  onImport,
  onSelectExisting,
}: ImportModalProps) {
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<LocalAgyConversation[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/agy/conversations")
      .then((r) => r.json())
      .then((data: { conversations?: LocalAgyConversation[] }) => {
        if (active) setConversations(data.conversations || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleClick = async (conv: LocalAgyConversation) => {
    if (conv.alreadyImportedChatId) {
      onSelectExisting(conv.alreadyImportedChatId);
      onClose();
      return;
    }
    setImportingId(conv.conversationId);
    await onImport(conv.conversationId);
    setImportingId(null);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-xs sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82dvh] w-full max-w-lg flex-col rounded-t-3xl border border-slate-800 bg-[#111827] shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-sky-400" />
            <h2 className="text-base font-semibold text-white">
              Importar chat do PC (agy CLI)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>Buscando sessões locais...</span>
            </div>
          ) : conversations.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              Nenhuma conversa local encontrada em{" "}
              <code className="text-xs text-slate-300">~/.gemini/antigravity-cli/brain</code>.
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conv) => {
                const isBusy = importingId === conv.conversationId;
                return (
                  <button
                    key={conv.conversationId}
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleClick(conv)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 text-left transition hover:border-indigo-500/50 hover:bg-slate-800/80"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {conv.preview}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{conv.messageCount} msgs</span>
                        <span>·</span>
                        <span>
                          {new Date(conv.updatedAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                      ) : conv.alreadyImportedChatId ? (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Abrir
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2.5 py-1 text-[11px] font-medium text-indigo-300">
                          <Download className="h-3.5 w-3.5" />
                          Importar
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
