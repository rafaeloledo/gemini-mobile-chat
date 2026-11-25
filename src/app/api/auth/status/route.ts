import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAuthEnabled,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";

export async function GET() {
  const authEnabled = isAuthEnabled();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const authenticated = await verifySessionToken(token);
  return NextResponse.json({ authEnabled, authenticated });
}
