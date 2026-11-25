"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Sparkles, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, remember }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Senha incorreta.");
        setLoading(false);
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const next = params.get("next") || "/";
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch {
      setError("Erro de conexão com o servidor.");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-5 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.18),_transparent_55%),#090d16]">
      <div className="w-full max-w-sm rounded-3xl border border-slate-800/80 bg-[#111827]/90 p-7 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/25">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Gemini Mobile Bridge
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Acesso seguro aos seus chats locais do PC
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
            >
              Senha de acesso
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite sua senha..."
                autoFocus
                autoComplete="current-password"
                className="w-full rounded-2xl border border-slate-700/80 bg-slate-900/90 py-3 pl-10 pr-11 text-base text-white placeholder-slate-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/25"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                aria-label="Mostrar ou ocultar senha"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-slate-300 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
            />
            Manter conectado neste celular (30 dias)
          </label>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Entrando...
              </>
            ) : (
              "Desbloquear"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
