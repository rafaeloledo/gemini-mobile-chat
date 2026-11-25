"use client";

import { useState } from "react";
import { Cpu, FolderGit2, Shield, X } from "lucide-react";
import type { AgyModel, ChatDetail, ExecutionMode } from "@/lib/types";

interface ChatSettingsModalProps {
  chat: ChatDetail;
  models: AgyModel[];
  workspaces: string[];
  onClose: () => void;
  onSave: (updates: {
    model: string;
    mode: ExecutionMode;
    workspacePath: string;
  }) => Promise<void>;
}

const MODE_OPTIONS: Array<{
  value: ExecutionMode;
  label: string;
  desc: string;
}> = [
  {
    value: "auto",
    label: "Auto (Recomendado)",
    desc: "Auto-aprova edições e comandos seguros no sandbox",
  },
  {
    value: "plan",
    label: "Plan (Somente leitura)",
    desc: "Pesquisa e planeja sem modificar arquivos",
  },
  {
    value: "accept-edits",
    label: "Accept Edits",
    desc: "Auto-aprova edições de arquivos no workspace",
  },
  {
    value: "dangerous",
    label: "Sem confirmação (Full Auto)",
    desc: "Passa --dangerously-skip-permissions ao agy",
  },
];

export function ChatSettingsModal({
  chat,
  models,
  workspaces,
  onClose,
  onSave,
}: ChatSettingsModalProps) {
  const [model, setModel] = useState(chat.model);
  const [mode, setMode] = useState<ExecutionMode>(chat.mode);
  const [workspacePath, setWorkspacePath] = useState(chat.workspacePath);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({ model, mode, workspacePath });
    setSaving(false);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-xs sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-slate-800 bg-[#111827] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Configurações do Chat</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Model */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              Modelo Gemini / Agente
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
            >
              <option value="">Padrão configurado no agy CLI</option>
              {models.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Workspace */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <FolderGit2 className="h-3.5 w-3.5 text-sky-400" />
              Pasta do projeto (cwd no PC)
            </label>
            <select
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500"
            >
              {!workspaces.includes(workspacePath) && (
                <option value={workspacePath}>{workspacePath}</option>
              )}
              {workspaces.map((ws) => (
                <option key={ws} value={ws}>
                  {ws}
                </option>
              ))}
            </select>
          </div>

          {/* Execution Mode */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              Modo de execução
            </label>
            <div className="space-y-1.5">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                    mode === opt.value
                      ? "border-indigo-500 bg-indigo-500/15"
                      : "border-slate-800 bg-slate-900/70 hover:border-slate-700"
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{opt.label}</div>
                  <div className="text-[11px] text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {chat.agyConversationId && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
              <span className="text-slate-500">ID da sessão agy: </span>
              <span className="font-mono text-slate-300">{chat.agyConversationId}</span>
            </div>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="w-full rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar configurações"}
          </button>
        </div>
      </div>
    </div>
  );
}
