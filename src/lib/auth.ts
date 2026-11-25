export const SESSION_COOKIE_NAME = "gmc_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getAuthSecret(): string {
  return process.env.AUTH_SECRET || "dev-fallback-secret-change-in-env";
}

export function getConfiguredPassword(): string {
  return (process.env.APP_PASSWORD || "").trim();
}

export function isAuthEnabled(): boolean {
  return getConfiguredPassword().length > 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyPassword(input: string): Promise<boolean> {
  const expected = getConfiguredPassword();
  if (!expected) return true;
  const [hashA, hashB] = await Promise.all([
    hmacSha256(input, getAuthSecret()),
    hmacSha256(expected, getAuthSecret()),
  ]);
  return constantTimeEqual(hashA, hashB);
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `v1.${exp}`;
  const sig = await hmacSha256(payload, getAuthSecret());
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expectedSig = await hmacSha256(`${parts[0]}.${parts[1]}`, getAuthSecret());
  return constantTimeEqual(parts[2], expectedSig);
}

export function getSessionCookieOptions(remember = true) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: remember ? SESSION_MAX_AGE_SECONDS : 60 * 60 * 12,
  };
}
