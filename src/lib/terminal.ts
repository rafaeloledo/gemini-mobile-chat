import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { IncomingMessage } from "http";
import type WebSocket from "ws";

const PTY_SCRIPT = path.resolve(process.cwd(), "scripts", "pty-bridge.py");

function isValidHost(host: string): boolean {
  return /^[a-zA-Z0-9._:\-]+$/.test(host) && !host.startsWith("-");
}

function isValidUser(user: string): boolean {
  return /^[a-zA-Z0-9._\-]+$/.test(user) && !user.startsWith("-");
}

function resolveShellCommand(): string[] {
  const envShell = process.env.TERMINAL_SHELL || process.env.SHELL || "";
  if (envShell && fs.existsSync(envShell)) {
    return [envShell];
  }
  if (fs.existsSync("/bin/bash")) return ["/bin/bash", "-l"];
  return ["/bin/sh"];
}

export function attachTerminalWebSocket(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || "/api/terminal/ws", `http://${req.headers.host || "localhost"}`);
  const mode = url.searchParams.get("mode") === "ssh" ? "ssh" : "local";
  const cols = Math.max(20, Math.min(300, Number(url.searchParams.get("cols")) || 80));
  const rows = Math.max(10, Math.min(120, Number(url.searchParams.get("rows")) || 24));

  let cwd = url.searchParams.get("cwd") || process.env.WORKSPACES_ROOT || process.cwd();
  try {
    if (!fs.statSync(cwd).isDirectory()) cwd = process.cwd();
  } catch {
    cwd = process.cwd();
  }

  let targetCmd: string[];
  if (mode === "ssh") {
    const host = (url.searchParams.get("host") || "").trim();
    const user = (url.searchParams.get("user") || "").trim();
    const portNum = Number(url.searchParams.get("port")) || 22;

    if (!host || !isValidHost(host)) {
      ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mErro: Host SSH inválido.\x1b[0m\r\n" }));
      ws.close(1008, "Invalid SSH host");
      return;
    }
    if (user && !isValidUser(user)) {
      ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mErro: Usuário SSH inválido.\x1b[0m\r\n" }));
      ws.close(1008, "Invalid SSH user");
      return;
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31mErro: Porta SSH inválida.\x1b[0m\r\n" }));
      ws.close(1008, "Invalid SSH port");
      return;
    }

    const destination = user ? `${user}@${host}` : host;
    targetCmd = [
      "/usr/bin/ssh",
      "-tt",
      "-p",
      String(portNum),
      "-o",
      "StrictHostKeyChecking=accept-new",
      "--",
      destination,
    ];
  } else {
    targetCmd = resolveShellCommand();
  }

  const ptyProc = spawn(
    "python3",
    [PTY_SCRIPT, cwd, String(cols), String(rows), ...targetCmd],
    {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const safeSend = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  safeSend({
    type: "ready",
    mode,
    cwd,
    command: mode === "ssh" ? targetCmd[targetCmd.length - 1] : path.basename(targetCmd[0]),
  });

  ptyProc.stdout?.on("data", (chunk: Buffer) => {
    safeSend({ type: "output", data: chunk.toString("utf8") });
  });

  ptyProc.stderr?.on("data", (chunk: Buffer) => {
    safeSend({ type: "output", data: chunk.toString("utf8") });
  });

  ptyProc.on("error", (err) => {
    safeSend({
      type: "output",
      data: `\r\n\x1b[31mFalha ao iniciar terminal PTY: ${err.message}\x1b[0m\r\n`,
    });
    ws.close(1011, "PTY spawn failed");
  });

  ptyProc.on("close", (code) => {
    safeSend({ type: "exit", code: code ?? 0 });
    if (ws.readyState === ws.OPEN) {
      ws.close(1000, "Process exited");
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString("utf8")) as {
        type?: string;
        data?: string;
        cols?: number;
        rows?: number;
      };
      if (msg.type === "input" && typeof msg.data === "string") {
        ptyProc.stdin?.write(`${JSON.stringify({ t: "i", d: msg.data })}\n`);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        ptyProc.stdin?.write(`${JSON.stringify({ t: "r", c: msg.cols, r: msg.rows })}\n`);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  const killPty = () => {
    if (!ptyProc.killed) {
      try {
        ptyProc.stdin?.end();
        ptyProc.kill("SIGTERM");
        setTimeout(() => {
          if (!ptyProc.killed) ptyProc.kill("SIGKILL");
        }, 1500);
      } catch {
        // ignore
      }
    }
  };

  ws.on("close", killPty);
  ws.on("error", killPty);
}
