"use client";

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  Camera,
  Image as ImageIcon,
  Mic,
  Send,
  Square,
  Trash2,
  X,
  AudioLines,
} from "lucide-react";

interface ComposerProps {
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  onSend: (payload: {
    text: string;
    audio?: { blob: Blob; durationSec: number };
    images: File[];
  }) => Promise<void> | void;
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function pickSupportedAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export function Composer({ disabled, isStreaming, onStop, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<{
    blob: Blob;
    url: string;
    durationSec: number;
  } | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartRef = useRef<number>(0);
  const sendAfterStopRef = useRef<boolean>(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // Cleanup object URLs & streams on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
    };
  }, []);

  const canSend =
    !disabled &&
    !isStreaming &&
    (text.trim().length > 0 || images.length > 0 || recordedAudio !== null);

  const clearRecordedAudio = () => {
    if (recordedAudio?.url) URL.revokeObjectURL(recordedAudio.url);
    setRecordedAudio(null);
  };

  const handleImagePick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const next: PendingImage[] = files.slice(0, 6).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...next].slice(0, 6));
    e.target.value = "";
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const submitAll = async (overrideAudio?: { blob: Blob; durationSec: number }) => {
    const audioToSend =
      overrideAudio ??
      (recordedAudio
        ? { blob: recordedAudio.blob, durationSec: recordedAudio.durationSec }
        : undefined);
    const trimmed = text.trim();
    const imgFiles = images.map((i) => i.file);

    if (!trimmed && !audioToSend && imgFiles.length === 0) return;

    // Reset composer state immediately for snappy UX
    setText("");
    images.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    setImages([]);
    clearRecordedAudio();
    setMicError(null);

    await onSend({
      text: trimmed,
      audio: audioToSend,
      images: imgFiles,
    });
  };

  const startRecording = async () => {
    setMicError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMicError(
        "Microfone indisponível. No celular, acesse via HTTPS (ex.: Tailscale ou Cloudflare Tunnel)."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mimeType = pickSupportedAudioMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      sendAfterStopRef.current = false;
      recordStartRef.current = Date.now();
      setRecordSeconds(0);

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        setRecording(false);

        const durationSec = Math.max(
          1,
          Math.round((Date.now() - recordStartRef.current) / 1000)
        );
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalType });
        chunksRef.current = [];

        if (blob.size < 200) return;

        if (sendAfterStopRef.current) {
          sendAfterStopRef.current = false;
          void submitAll({ blob, durationSec });
        } else {
          clearRecordedAudio();
          setRecordedAudio({
            blob,
            url: URL.createObjectURL(blob),
            durationSec,
          });
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 300);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setMicError(
        msg.includes("NotAllowed") || msg.includes("Permission")
          ? "Permissão do microfone negada no navegador."
          : "Não foi possível abrir o microfone. Verifique se está usando HTTPS no celular."
      );
    }
  };

  const stopRecording = (sendImmediately: boolean) => {
    sendAfterStopRef.current = sendImmediately;
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  };

  const cancelRecording = () => {
    sendAfterStopRef.current = false;
    chunksRef.current = [];
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        setRecording(false);
      };
      rec.stop();
    } else {
      setRecording(false);
    }
  };

  const toggleDictation = () => {
    setMicError(null);
    if (dictating) {
      recognitionRef.current?.stop();
      setDictating(false);
      return;
    }

    type SpeechRecognitionCtor = new () => {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Ctor) {
      setMicError("Ditado por texto não suportado neste navegador. Use o botão de áudio!");
      return;
    }

    const rec = new Ctor();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const parts: string[] = [];
      for (let i = 0; i < ev.results.length; i++) {
        parts.push(ev.results[i][0].transcript);
      }
      const spoken = parts.join(" ").trim();
      if (spoken) {
        setText((prev) => (prev ? `${prev} ${spoken}` : spoken));
      }
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);

    recognitionRef.current = rec;
    setDictating(true);
    rec.start();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // On desktop Enter sends; on mobile users can also tap Send
      if (window.innerWidth >= 768) {
        e.preventDefault();
        if (canSend) void submitAll();
      }
    }
  };

  return (
    <div className="border-t border-slate-800/80 bg-[#0b101c]/95 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
      <div className="mx-auto max-w-3xl space-y-2">
        {micError && (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span>{micError}</span>
            <button
              type="button"
              onClick={() => setMicError(null)}
              className="p-0.5 text-amber-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Pending image previews */}
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt="Prévia"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/75 p-0.5 text-white"
                  aria-label="Remover imagem"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recorded audio preview before sending */}
        {recordedAudio && !recording && (
          <div className="flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-indigo-950/30 px-3 py-2">
            <Mic className="h-4 w-4 shrink-0 text-indigo-400" />
            <audio
              controls
              src={recordedAudio.url}
              className="h-8 min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={clearRecordedAudio}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
              aria-label="Descartar áudio"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Hidden file inputs */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleImagePick}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleImagePick}
        />

        {/* Active Recording Bar OR Normal Composer */}
        {recording ? (
          <div className="flex items-center justify-between gap-2 rounded-3xl border border-rose-500/40 bg-rose-950/30 px-3 py-2.5">
            <button
              type="button"
              onClick={cancelRecording}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/90 text-slate-300 transition active:scale-95"
              aria-label="Cancelar gravação"
            >
              <Trash2 className="h-4 w-4" />
            </button>

            <div className="flex flex-1 items-center justify-center gap-3">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-mono text-sm font-semibold text-rose-200">
                {formatTimer(recordSeconds)}
              </span>
              <div className="flex h-6 items-center gap-1">
                {[0, 1, 2, 3, 4, 5].map((bar) => (
                  <span
                    key={bar}
                    style={{ animationDelay: `${bar * 120}ms` }}
                    className="animate-wave h-full w-1 rounded-full bg-rose-400"
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="flex h-10 items-center justify-center rounded-full bg-slate-800 px-3 text-xs font-medium text-slate-200 transition active:scale-95"
                title="Parar e ouvir antes de enviar"
              >
                Parar
              </button>
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-lg shadow-indigo-500/30 transition active:scale-95"
                aria-label="Enviar áudio agora"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-1.5 rounded-3xl border border-slate-700/80 bg-[#111827] px-2 py-1.5 shadow-inner focus-within:border-indigo-500/70">
            {/* Camera & Gallery buttons */}
            <div className="flex items-center pb-0.5">
              <button
                type="button"
                disabled={disabled || isStreaming}
                onClick={() => cameraInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                title="Tirar foto"
                aria-label="Tirar foto"
              >
                <Camera className="h-[19px] w-[19px]" />
              </button>
              <button
                type="button"
                disabled={disabled || isStreaming}
                onClick={() => galleryInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 disabled:opacity-40"
                title="Anexar imagem"
                aria-label="Anexar imagem"
              >
                <ImageIcon className="h-[19px] w-[19px]" />
              </button>
            </div>

            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              placeholder={
                dictating
                  ? "Ouvindo ditado..."
                  : "Mensagem ou grave um áudio..."
              }
              className="max-h-36 min-h-[38px] flex-1 resize-none bg-transparent py-2 text-[15px] text-white placeholder-slate-500 outline-none"
            />

            <div className="flex items-center gap-1 pb-0.5">
              {/* Optional quick dictation to text */}
              {!isStreaming && !canSend && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  disabled={disabled}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                    dictating
                      ? "bg-sky-500/25 text-sky-300 animate-pulse"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  }`}
                  title="Ditar para texto"
                  aria-label="Ditar para texto"
                >
                  <AudioLines className="h-[18px] w-[18px]" />
                </button>
              )}

              {/* Primary action: Stop OR Send OR Record Native Audio */}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/90 text-white shadow-md transition active:scale-95"
                  title="Parar geração"
                  aria-label="Parar geração"
                >
                  <Square className="h-4 w-4 fill-current" />
                </button>
              ) : canSend ? (
                <button
                  type="button"
                  onClick={() => void submitAll()}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-lg shadow-indigo-500/25 transition active:scale-95"
                  title="Enviar"
                  aria-label="Enviar mensagem"
                >
                  <Send className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void startRecording()}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 text-white shadow-lg shadow-indigo-500/25 transition active:scale-95 disabled:opacity-40"
                  title="Gravar áudio nativo para o Gemini"
                  aria-label="Gravar mensagem de voz"
                >
                  <Mic className="h-[19px] w-[19px]" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
