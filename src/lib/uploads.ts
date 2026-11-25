import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import type { Attachment } from "./types";

const execFileAsync = promisify(execFile);

export function getUploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR || "./data/uploads";
  return path.resolve(process.cwd(), configured);
}

function sanitizeSegment(seg: string): string {
  return seg.replace(/[^a-zA-Z0-9._-]/g, "");
}

function extFromMime(mimeType: string, fallback: string): string {
  const clean = mimeType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
  };
  return map[clean] || fallback;
}

export function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(".", "");
  const map: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    webm: "audio/webm",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  return map[ext] || "application/octet-stream";
}

export async function saveUploadedFile(
  chatId: string,
  file: File,
  kind: "audio" | "image",
  durationSec?: number
): Promise<Attachment> {
  const safeChatId = sanitizeSegment(chatId);
  const chatDir = path.join(getUploadsRoot(), safeChatId);
  await fs.mkdir(chatDir, { recursive: true });

  const id = crypto.randomUUID();
  const mime = file.type || (kind === "audio" ? "audio/webm" : "image/jpeg");
  const rawExt = extFromMime(mime, kind === "audio" ? "webm" : "jpg");
  const rawFilename = `${kind}-${id}.${rawExt}`;
  const rawPath = path.join(chatDir, rawFilename);

  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(rawPath, bytes);

  let finalFilename = rawFilename;
  let finalPath = rawPath;
  let finalMime = mime.split(";")[0].trim() || (kind === "audio" ? "audio/webm" : "image/jpeg");
  let finalSize = bytes.length;

  // Transcode mobile browser recordings (webm/mp4/ogg) to clean 16kHz mono mp3
  // so both mobile browsers (iOS/Android) and Gemini/agy read_file decode them cleanly.
  if (kind === "audio" && rawExt !== "mp3" && rawExt !== "wav") {
    const mp3Filename = `audio-${id}.mp3`;
    const mp3Path = path.join(chatDir, mp3Filename);
    try {
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", rawPath, "-ac", "1", "-ar", "16000", "-b:a", "64k", mp3Path],
        { timeout: 20_000 }
      );
      const stat = await fs.stat(mp3Path);
      if (stat.size > 0) {
        await fs.unlink(rawPath).catch(() => {});
        finalFilename = mp3Filename;
        finalPath = mp3Path;
        finalMime = "audio/mpeg";
        finalSize = stat.size;
      }
    } catch {
      // Fall back to original recorded file if ffmpeg fails or is unavailable
    }
  }

  return {
    id,
    type: kind,
    url: `/api/uploads/${encodeURIComponent(safeChatId)}/${encodeURIComponent(finalFilename)}`,
    absPath: finalPath,
    mimeType: finalMime,
    filename: finalFilename,
    sizeBytes: finalSize,
    durationSec,
  };
}

export function resolveSafeUploadPath(chatId: string, filename: string): string | null {
  const safeChat = sanitizeSegment(chatId);
  const safeFile = sanitizeSegment(filename);
  if (!safeChat || !safeFile || safeFile !== filename || safeChat !== chatId) {
    return null;
  }
  const root = getUploadsRoot();
  const resolved = path.resolve(root, safeChat, safeFile);
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

export async function deleteChatUploads(chatId: string): Promise<void> {
  const safeChat = sanitizeSegment(chatId);
  if (!safeChat) return;
  const chatDir = path.resolve(getUploadsRoot(), safeChat);
  if (chatDir.startsWith(getUploadsRoot() + path.sep)) {
    await fs.rm(chatDir, { recursive: true, force: true }).catch(() => {});
  }
}
