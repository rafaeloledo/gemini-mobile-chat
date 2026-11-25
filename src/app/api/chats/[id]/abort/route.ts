import { NextResponse } from "next/server";
import { abortChatRun } from "@/lib/agy";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const aborted = abortChatRun(id);
  return NextResponse.json({ ok: true, aborted });
}
