import { NextResponse } from "next/server";
import { listAgyModels, listWorkspaces } from "@/lib/agy";

export async function GET() {
  const [models, workspaces] = await Promise.all([
    listAgyModels(),
    listWorkspaces(),
  ]);
  return NextResponse.json({ models, workspaces });
}
