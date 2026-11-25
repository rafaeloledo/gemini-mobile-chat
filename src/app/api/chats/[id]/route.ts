import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serializeChatDetail } from "@/lib/serializers";
import { abortChatRun } from "@/lib/agy";
import { deleteChatUploads } from "@/lib/uploads";
import type { ExecutionMode } from "@/lib/types";

const ALLOWED_MODES: ExecutionMode[] = ["auto", "plan", "accept-edits", "dangerous"];

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const chat = await prisma.chat.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!chat) {
    return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ chat: serializeChatDetail(chat) });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      title?: string;
      model?: string;
      mode?: string;
      workspacePath?: string;
    };

    const data: Record<string, string> = {};
    if (typeof body.title === "string" && body.title.trim()) {
      data.title = body.title.trim().slice(0, 120);
    }
    if (typeof body.model === "string") {
      data.model = body.model.trim();
    }
    if (typeof body.mode === "string" && ALLOWED_MODES.includes(body.mode as ExecutionMode)) {
      data.mode = body.mode;
    }
    if (typeof body.workspacePath === "string" && body.workspacePath.trim()) {
      data.workspacePath = body.workspacePath.trim();
    }

    const updated = await prisma.chat.update({
      where: { id },
      data,
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    return NextResponse.json({ chat: serializeChatDetail(updated) });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar o chat" }, { status: 400 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    abortChatRun(id);
    await prisma.chat.delete({ where: { id } });
    await deleteChatUploads(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Chat não encontrado" }, { status: 404 });
  }
}
