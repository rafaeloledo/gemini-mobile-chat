import { NextResponse } from "next/server";
import {
  createSessionToken,
  getSessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string; remember?: boolean };
    const password = typeof body.password === "string" ? body.password : "";
    const remember = body.remember !== false;

    const ok = await verifyPassword(password);
    if (!ok) {
      return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });
    }

    const token = await createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      ...getSessionCookieOptions(remember),
      value: token,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
}
