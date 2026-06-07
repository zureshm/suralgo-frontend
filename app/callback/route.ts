import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const client = req.nextUrl.searchParams.get("client");

  console.log("Flattrade callback received:", { code, client });

  // Redirect to dashboard with code in URL params
  const redirectUrl = new URL("/dashboard", req.url);
  if (code) redirectUrl.searchParams.set("code", code);
  if (client) redirectUrl.searchParams.set("client", client);

  return NextResponse.redirect(redirectUrl);
}
