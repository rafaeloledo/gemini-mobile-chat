import http from "http";
import fs from "fs";
import path from "path";
import next from "next";
import { WebSocketServer } from "ws";
import {
  isAuthEnabled,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "./src/lib/auth";
import { attachTerminalWebSocket } from "./src/lib/terminal";

// Load .env into process.env before auth checks run on WebSocket upgrades
function loadEnvFile(filename: string) {
  const fullPath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

// Parse optional CLI flags (-H / --hostname, -p / --port)
function parseCliArgs() {
  const args = process.argv.slice(2);
  let hostname = process.env.HOST || "0.0.0.0";
  let port = Number(process.env.PORT) || 3000;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-H" || args[i] === "--hostname") && args[i + 1]) {
      hostname = args[++i];
    } else if ((args[i] === "-p" || args[i] === "--port") && args[i + 1]) {
      port = Number(args[++i]) || port;
    }
  }
  return { hostname, port };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function isSameOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

const dev = process.env.NODE_ENV !== "production";
const { hostname, port } = parseCliArgs();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const wss = new WebSocketServer({ noServer: true });
  const nextUpgradeHandler = app.getUpgradeHandler();

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  server.on("upgrade", async (req, socket, head) => {
    const urlPath = (req.url || "").split("?")[0];

    if (urlPath === "/api/terminal/ws") {
      if (!isSameOrigin(req)) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      if (isAuthEnabled()) {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies[SESSION_COOKIE_NAME];
        const valid = await verifySessionToken(token);
        if (!valid) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        attachTerminalWebSocket(ws, req);
      });
      return;
    }

    // Forward Next.js dev HMR and other upgrades untouched
    void nextUpgradeHandler(req, socket, head);
  });

  server.listen(port, hostname, () => {
    console.log(
      `> Gemini Mobile Bridge ready on http://${hostname}:${port} (${dev ? "dev" : "prod"}) — Chat + Terminal PTY/SSH enabled`
    );
  });
});
