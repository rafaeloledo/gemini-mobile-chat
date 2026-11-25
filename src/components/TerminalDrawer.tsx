"use client";

import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ClipboardPaste,
  Laptop,
  Minus,
  Plug,
  RotateCcw,
  Server,
  ShieldCheck,
  Terminal as TerminalIcon,
  Trash2,
  X,
} from "lucide-react";

interface TerminalDrawerProps {
  visible: boolean;
  workspacePath: string;
  onMinimize: () => void;
  onCloseSession: () => void;
  onStatusChange?: (connected: boolean) => void;
}

interface SshProfile {
  id: string;
  label: string;
  user: string;
  host: string;
  port: string;
}

const SSH_PROFILES_KEY = "gmc_ssh_profiles_v1";

function loadSavedProfiles(): SshProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SSH_PROFILES_KEY);
    return raw ? (JSON.parse(raw) as SshProfile[]) : [];
  } catch {
    return [];
  }
}

export function TerminalDrawer({
  visible,
  workspacePath,
  onMinimize,
  onCloseSession,
  onStatusChange,
}: TerminalDrawerProps) {
  const [mode, setMode] = useState<"local" | "ssh">("local");
  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState("Conectando...");
  const [fontSize, setFontSize] = useState(13);
  const [ctrlActive, setCtrlActive] = useState(false);

  // SSH form state (passwords are NEVER saved — typed directly into PTY)
  const [sshUser, setSshUser] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [showSshForm, setShowSshForm] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const ctrlActiveRef = useRef(false);

  useEffect(() => {
    ctrlActiveRef.current = ctrlActive;
  }, [ctrlActive]);

  useEffect(() => {
    setProfiles(loadSavedProfiles());
  }, []);

  useEffect(() => {
    onStatusChange?.(connected);
  }, [connected, onStatusChange]);

  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  const sendResize = useCallback(() => {
    const fit = fitAddonRef.current;
    const term = termRef.current;
    const ws = wsRef.current;
    if (!fit || !term) return;
    try {
      fit.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    } catch {
      // ignore if hidden
    }
  }, []);

  const connectSocket = useCallback(
    (opts: {
      mode: "local" | "ssh";
      cwd?: string;
      user?: string;
      host?: string;
      port?: string;
    }) => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const term = termRef.current;
      const fit = fitAddonRef.current;
      if (term) {
        term.clear();
        term.writeln(
          opts.mode === "ssh"
            ? `\x1b[36mConectando via SSH a ${opts.user ? `${opts.user}@` : ""}${opts.host}:${opts.port || "22"}...\x1b[0m`
            : `\x1b[36mIniciando shell local em ${opts.cwd || "workspace"}...\x1b[0m`
        );
      }

      let cols = 80;
      let rows = 24;
      if (fit && term) {
        try {
          fit.fit();
          cols = term.cols;
          rows = term.rows;
        } catch {
          // use defaults
        }
      }

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const params = new URLSearchParams({
        mode: opts.mode,
        cols: String(cols),
        rows: String(rows),
      });
      if (opts.cwd) params.set("cwd", opts.cwd);
      if (opts.mode === "ssh") {
        if (opts.host) params.set("host", opts.host);
        if (opts.user) params.set("user", opts.user);
        if (opts.port) params.set("port", opts.port);
      }

      setConnected(false);
      setStatusText("Conectando...");

      const ws = new WebSocket(`${proto}//${window.location.host}/api/terminal/ws?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setStatusText(
          opts.mode === "ssh"
            ? `SSH · ${opts.user ? `${opts.user}@` : ""}${opts.host}`
            : "Shell Local (PTY)"
        );
        setTimeout(() => {
          sendResize();
          termRef.current?.focus();
        }, 120);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            data?: string;
            code?: number;
          };
          if (msg.type === "output" && typeof msg.data === "string") {
            termRef.current?.write(msg.data);
          } else if (msg.type === "exit") {
            termRef.current?.writeln(
              `\r\n\x1b[33m[Sessão encerrada com código ${msg.code ?? 0}]\x1b[0m`
            );
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        setConnected(false);
        setStatusText("Erro na conexão WebSocket");
      };

      ws.onclose = () => {
        setConnected(false);
        setStatusText("Desconectado");
      };
    },
    [sendResize]
  );

  // Initialize xterm.js once on mount
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    async function initTerminal() {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);

      // Ensure CommitMono Nerd Font is loaded before xterm measures glyph cell widths
      if (typeof document !== "undefined" && "fonts" in document) {
        await Promise.race([
          Promise.all([
            document.fonts.load(`400 ${fontSize}px "CommitMono Nerd Font"`),
            document.fonts.load(`700 ${fontSize}px "CommitMono Nerd Font"`),
          ]).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
      }

      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily:
          '"CommitMono Nerd Font", var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
        scrollback: 3000,
        convertEol: false,
        theme: {
          background: "#090d16",
          foreground: "#e2e8f0",
          cursor: "#38bdf8",
          selectionBackground: "rgba(99, 102, 241, 0.35)",
          black: "#0f172a",
          red: "#fb7185",
          green: "#34d399",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#38bdf8",
          white: "#f1f5f9",
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      term.onData((data) => {
        if (ctrlActiveRef.current && data.length === 1) {
          const code = data.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 95) {
            setCtrlActive(false);
            sendInput(String.fromCharCode(code - 64));
            return;
          }
          setCtrlActive(false);
        }
        sendInput(data);
      });

      resizeObserver = new ResizeObserver(() => {
        sendResize();
      });
      resizeObserver.observe(containerRef.current);

      connectSocket({ mode: "local", cwd: workspacePath });
    }

    void initTerminal();

    const onViewportResize = () => sendResize();
    window.visualViewport?.addEventListener("resize", onViewportResize);

    return () => {
      disposed = true;
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      resizeObserver?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // Intentionally initialize once per mounted session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refit and focus whenever drawer becomes visible or font size changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize;
    }
    if (visible) {
      const t = setTimeout(() => {
        sendResize();
        termRef.current?.focus();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [visible, fontSize, sendResize]);

  const handleConnectSsh = (e: FormEvent) => {
    e.preventDefault();
    const host = sshHost.trim();
    const user = sshUser.trim();
    const port = sshPort.trim() || "22";
    if (!host) return;

    // Save profile (host/user/port only, never passwords)
    const id = `${user}@${host}:${port}`;
    const nextProfiles = [
      { id, label: id, user, host, port },
      ...profiles.filter((p) => p.id !== id),
    ].slice(0, 8);
    setProfiles(nextProfiles);
    try {
      window.localStorage.setItem(SSH_PROFILES_KEY, JSON.stringify(nextProfiles));
    } catch {
      // ignore
    }

    setMode("ssh");
    setShowSshForm(false);
    connectSocket({ mode: "ssh", user, host, port });
  };

  const removeProfile = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    try {
      window.localStorage.setItem(SSH_PROFILES_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip) sendInput(clip);
      termRef.current?.focus();
    } catch {
      // ignore
    }
  };

  const quickKey = (seq: string) => {
    sendInput(seq);
    termRef.current?.focus();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-[#090d16] transition-opacity duration-150 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      aria-hidden={!visible}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-[#0b101c] px-3 pt-[max(0.65rem,env(safe-area-inset-top))] pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-sky-400">
            <TerminalIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  connected ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              <span className="truncate text-xs font-semibold text-white">
                {statusText}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400">
              <ShieldCheck className="h-3 w-3 text-emerald-400/80" />
              <span className="truncate">Senhas de sudo/SSH não passam pelo Gemini</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Mode buttons */}
          <button
            type="button"
            onClick={() => {
              setMode("local");
              setShowSshForm(false);
              connectSocket({ mode: "local", cwd: workspacePath });
            }}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition ${
              mode === "local" && !showSshForm
                ? "bg-indigo-500/25 text-indigo-300"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
            title="Shell local do PC (aceita sudo)"
          >
            <Laptop className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Local</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSshForm((v) => !v)}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-medium transition ${
              mode === "ssh" || showSshForm
                ? "bg-sky-500/25 text-sky-300"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
            title="Conectar via SSH a um servidor"
          >
            <Server className="h-3.5 w-3.5" />
            <span>SSH</span>
          </button>

          {/* Font size */}
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            className="rounded-xl px-2 py-1.5 text-xs font-mono text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Diminuir fonte"
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.min(20, s + 1))}
            className="rounded-xl px-2 py-1.5 text-xs font-mono text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Aumentar fonte"
          >
            A+
          </button>

          {/* Reconnect */}
          <button
            type="button"
            onClick={() =>
              connectSocket(
                mode === "ssh" && sshHost
                  ? { mode: "ssh", user: sshUser, host: sshHost, port: sshPort }
                  : { mode: "local", cwd: workspacePath }
              )
            }
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            title="Reiniciar sessão"
            aria-label="Reiniciar terminal"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          {/* Minimize (keep session alive) */}
          <button
            type="button"
            onClick={onMinimize}
            className="rounded-xl p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            title="Minimizar (mantém o terminal ativo em segundo plano)"
            aria-label="Minimizar terminal"
          >
            <Minus className="h-4 w-4" />
          </button>

          {/* Close & Kill */}
          <button
            type="button"
            onClick={onCloseSession}
            className="rounded-xl p-2 text-rose-400 hover:bg-rose-500/20"
            title="Encerrar terminal"
            aria-label="Encerrar terminal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Collapsible SSH Connection Form */}
      {showSshForm && (
        <div className="border-b border-slate-800 bg-[#111827] px-3 py-3">
          <form onSubmit={handleConnectSsh} className="mx-auto max-w-2xl space-y-2.5">
            <div className="grid grid-cols-12 gap-2">
              <input
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="usuário (ex: root)"
                className="col-span-4 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
              <input
                type="text"
                required
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="host ou IP (ex: 192.168.1.10)"
                className="col-span-5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
              <input
                type="number"
                min={1}
                max={65535}
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                placeholder="22"
                className="col-span-3 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400">
                A senha ou chave SSH será solicitada diretamente no terminal.
              </span>
              <button
                type="submit"
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-2 text-xs font-semibold text-white"
              >
                <Plug className="h-3.5 w-3.5" />
                Conectar SSH
              </button>
            </div>

            {profiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 pl-2.5 pr-1 py-1 text-xs text-slate-200"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSshUser(p.user);
                        setSshHost(p.host);
                        setSshPort(p.port);
                        setMode("ssh");
                        setShowSshForm(false);
                        connectSocket({
                          mode: "ssh",
                          user: p.user,
                          host: p.host,
                          port: p.port,
                        });
                      }}
                      className="font-mono hover:text-sky-300"
                    >
                      {p.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeProfile(p.id)}
                      className="rounded-full p-0.5 text-slate-500 hover:text-rose-400"
                      aria-label="Remover perfil"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </form>
        </div>
      )}

      {/* Terminal Viewport */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden p-2"
        onClick={() => termRef.current?.focus()}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* Mobile Shortcut Keys Toolbar */}
      <div className="border-t border-slate-800 bg-[#0b101c] px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => quickKey("\x1b")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ESC
          </button>
          <button
            type="button"
            onClick={() => quickKey("\t")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            TAB
          </button>
          <button
            type="button"
            onClick={() => {
              setCtrlActive((v) => !v);
              termRef.current?.focus();
            }}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
              ctrlActive
                ? "border-sky-400 bg-sky-500/25 text-sky-200"
                : "border-slate-700 bg-slate-900 text-slate-200"
            }`}
          >
            CTRL
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x03")}
            className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-1.5 font-mono text-xs text-rose-200 active:bg-rose-900/60"
          >
            ^C
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x04")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ^D
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x1b[A")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x1b[B")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x1b[D")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => quickKey("\x1b[C")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => quickKey("|")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            |
          </button>
          <button
            type="button"
            onClick={() => quickKey("/")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            /
          </button>
          <button
            type="button"
            onClick={() => quickKey("~")}
            className="shrink-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200 active:bg-slate-700"
          >
            ~
          </button>
          <button
            type="button"
            onClick={() => void handlePaste()}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 active:bg-slate-700"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Colar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
