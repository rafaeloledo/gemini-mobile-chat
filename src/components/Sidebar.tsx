"use client";

import { useState } from "react";
import {
  Check,
  Download,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { ChatSummary } from "@/lib/types";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onOpenImport: () => void;
  onRenameChat: (id: string, title: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function Sidebar({
  open,
  onClose,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onOpenImport,
  onRenameChat,
  onDeleteChat,
  onLogout,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const filtered = query.trim()
    ? chats.filter(
        (c) =>
          c.title.toLowerCase().includes(query.toLowerCase()) ||
          (c.lastMessagePreview || "").toLowerCase().includes(query.toLowerCase())
      )
    : chats;

  const commitRename = async (id: string) => {
    const trimmed = editTitle.trim();
    setEditingId(null);
    if (trimmed) {
      await onRenameChat(id, trimmed);
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/65 backdrop-blur-xs transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[84vw] max-w-[310px] flex-col border-r border-slate-800/80 bg-[#0b101c] transition-transform duration-200 lg:static lg:w-76 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Gemini Mobile</div>
              <div className="text-[11px] text-slate-400">Local agy CLI Bridge</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action buttons */}
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onNewChat();
                onClose();
              }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 px-3 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              <span>Novo chat</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenImport();
                onClose();
              }}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900 px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 active:scale-[0.98]"
              title="Importar conversa existente do PC (agy)"
            >
              <Download className="h-4 w-4 text-sky-400" />
              <span>PC</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversas..."
              className="w-full rounded-xl border border-slate-800 bg-slate-900/90 py-2 pl-8 pr-3 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500/60"
            />
          </div>
        </div>

        {/* Chats list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-500">
              {chats.length === 0
                ? "Nenhuma conversa ainda. Toque em Novo chat ou importe uma sessão do PC."
                : "Nenhum chat encontrado para essa busca."}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((chat) => {
                const isActive = chat.id === activeChatId;
                const isEditing = editingId === chat.id;
                const folderName = chat.workspacePath.split("/").filter(Boolean).pop() || "repos";

                return (
                  <div
                    key={chat.id}
                    className={`group rounded-2xl transition ${
                      isActive
                        ? "bg-indigo-500/15 ring-1 ring-indigo-500/35"
                        : "hover:bg-slate-800/55"
                    }`}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 p-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitRename(chat.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="min-w-0 flex-1 rounded-lg border border-indigo-500 bg-slate-900 px-2 py-1 text-xs text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void commitRename(chat.id)}
                          className="rounded-lg p-1.5 text-emerald-400 hover:bg-slate-800"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectChat(chat.id);
                            onClose();
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-100">
                              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                              <span className="truncate">{chat.title}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-500">
                              {formatShortDate(chat.updatedAt)}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-slate-400">
                            {chat.lastMessagePreview || `Pasta: ${folderName}`}
                          </div>
                        </button>

                        <div className="flex shrink-0 items-center gap-0.5 pt-0.5 opacity-80 lg:opacity-0 lg:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(chat.id);
                              setEditTitle(chat.title);
                            }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700/70 hover:text-white"
                            aria-label="Renomear chat"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteChat(chat.id)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                            aria-label="Apagar chat"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800/80 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => void onLogout()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 py-2 text-xs font-medium text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Bloquear / Sair</span>
          </button>
        </div>
      </aside>
    </>
  );
}
