import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { listLocalAgyConversations } from "@/lib/agy";

export async function GET() {
  const existing = await prisma.chat.findMany({
    where: { agyConversationId: { not: null } },
    select: { id: true, agyConversationId: true },
  });
  const map = new Map<string, string>();
  for (const c of existing) {
    if (c.agyConversationId) map.set(c.agyConversationId, c.id);
  }

  const conversations = await listLocalAgyConversations(map);
  return NextResponse.json({ conversations });
}
