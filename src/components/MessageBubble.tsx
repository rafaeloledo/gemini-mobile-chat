"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Mic,
  Sparkles,
  Square,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import type { MessageItem, ToolEvent } from "@/lib/types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  message: MessageItem;
  isStreaming?: boolean;
  isSpeaking?: boolean;
  onToggleSpeak?: (message: MessageItem) => void;
}

function ToolActivityBadge({
  tools,
  isStreaming,
}: {
  tools: ToolEvent[];
  isStreaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (tools.length === 0) return null;

  const activeTool = tools.find((t) => t.state === "ACTIVE");

  return (
    <div className="mb-2.5 rounded-xl border border-slate-700/60 bg-slate-900/70 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-slate-300"
      >
        <span className="flex items-center gap-2 truncate">
          {activeTool || isStreaming ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
          ) : (
            <Wrench className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          )}
          <span className="truncate font-medium">
            {activeTool
              ? `Executando: ${activeTool.toolName}`
              : `${tools.length} ${tools.length === 1 ? "ação do agente" : "ações do agente"}`}
          </span>
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-slate-800 px-3 py-2">
          {tools.map((tool) => (
            <div
              key={`${tool.stepIndex}-${tool.toolName}`}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <div className="flex items-center gap-1.5 truncate">
                {tool.state === "ACTIVE" ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sky-400" />
                ) : tool.error ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
                ) : (
                  <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                )}
                <span className="font-mono text-indigo-300">{tool.toolName}</span>
                {tool.summary && tool.summary !== tool.toolName && (
                  <span className="truncate text-slate-400">· {tool.summary}</span>
                )}
              </div>
              {typeof tool.durationSeconds === "number" && (
                <span className="shrink-0 font-mono text-slate-500">
                  {tool.durationSeconds.toFixed(1)}s
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  message,
  isStreaming,
  isSpeaking,
  onToggleSpeak,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const isUser = message.role === "user";
  const isError = message.role === "error";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  if (isUser) {
    const audioAtts = message.attachments.filter((a) => a.type === "audio");
    const imageAtts = message.attachments.filter((a) => a.type === "image");

    return (
      <>
        <div className="flex justify-end">
          <div className="max-w-[88%] sm:max-w-[78%] rounded-3xl rounded-br-lg bg-gradient-to-br from-indigo-600 to-sky-600 px-4 py-3 text-white shadow-md shadow-indigo-950/40">
            {imageAtts.length > 0 && (
              <div
                className={`mb-2 grid gap-2 ${
                  imageAtts.length === 1 ? "grid-cols-1" : "grid-cols-2"
                }`}
              >
                {imageAtts.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightboxUrl(img.url)}
                    className="overflow-hidden rounded-2xl border border-white/15 bg-black/20"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt="Imagem enviada"
                      className="max-h-56 w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {audioAtts.map((audio) => (
              <div
                key={audio.id}
                className="mb-2 flex flex-col gap-1.5 rounded-2xl bg-black/20 p-2.5"
              >
                <div className="flex items-center gap-1.5 text-xs text-sky-100/90">
                  <Mic className="h-3.5 w-3.5" />
                  <span>
                    Mensagem de voz
                    {audio.durationSec ? ` · ${Math.round(audio.durationSec)}s` : ""}
                  </span>
                </div>
                <audio
                  controls
                  preload="metadata"
                  src={audio.url}
                  className="h-9 w-full min-w-[210px] max-w-full"
                />
              </div>
            ))}

            {message.content && (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
                {message.content}
              </p>
            )}
          </div>
        </div>

        {lightboxUrl && (
          <div
            onClick={() => setLightboxUrl(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              className="absolute right-4 top-4 rounded-full bg-white/15 p-2.5 text-white"
              aria-label="Fechar imagem"
            >
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Visualização ampliada"
              className="max-h-[88dvh] max-w-full rounded-xl object-contain"
            />
          </div>
        )}
      </>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[92%] rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          <div className="mb-1 flex items-center gap-2 font-semibold text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            <span>Erro na execução</span>
          </div>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 sm:gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500 shadow-sm">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <ToolActivityBadge tools={message.toolEvents} isStreaming={isStreaming} />

        <div className="rounded-3xl rounded-tl-lg border border-slate-800/90 bg-[#111827]/95 px-4 py-3 shadow-sm">
          {message.content ? (
            <MarkdownRenderer content={message.content} />
          ) : (
            <div className="flex items-center gap-2 py-1 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>Gemini está pensando...</span>
            </div>
          )}

          {!isStreaming && message.content && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
              <div className="flex items-center gap-1">
                {onToggleSpeak && (
                  <button
                    type="button"
                    onClick={() => onToggleSpeak(message)}
                    className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium transition ${
                      isSpeaking
                        ? "bg-indigo-500/25 text-indigo-300"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {isSpeaking ? (
                      <>
                        <Square className="h-3 w-3 fill-current" />
                        <span>Parar voz</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Ouvir</span>
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copiado</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </button>
              </div>

              {message.usage && (
                <span className="font-mono text-[11px] text-slate-500">
                  {typeof message.usage.duration_seconds === "number"
                    ? `${message.usage.duration_seconds.toFixed(1)}s`
                    : ""}
                  {typeof message.usage.duration_seconds === "number" &&
                  message.usage.output_tokens
                    ? " · "
                    : ""}
                  {message.usage.output_tokens
                    ? `${message.usage.output_tokens} tok`
                    : ""}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
