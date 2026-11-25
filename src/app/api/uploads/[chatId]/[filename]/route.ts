import fs from "fs";
import fsp from "fs/promises";
import { mimeFromFilename, resolveSafeUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string; filename: string }> }
) {
  const { chatId, filename } = await context.params;
  const absPath = resolveSafeUploadPath(chatId, filename);
  if (!absPath) {
    return new Response("Invalid path", { status: 400 });
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const fileSize = stat.size;
  const contentType = mimeFromFilename(filename);
  const rangeHeader = request.headers.get("range");

  // Support HTTP Range requests (required for Safari/iOS <audio> playback)
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
      if (start >= fileSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const chunkSize = end - start + 1;
      const nodeStream = fs.createReadStream(absPath, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          nodeStream.on("data", (chunk) => controller.enqueue(chunk));
          nodeStream.on("end", () => controller.close());
          nodeStream.on("error", (err) => controller.error(err));
        },
        cancel() {
          nodeStream.destroy();
        },
      });
      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=86400",
        },
      });
    }
  }

  const data = await fsp.readFile(absPath);
  return new Response(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
