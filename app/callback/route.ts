import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const client = req.nextUrl.searchParams.get("client");
  const requestToken = req.nextUrl.searchParams.get("request_token") || req.nextUrl.searchParams.get("requestToken");
  const action = req.nextUrl.searchParams.get("action");
  const status = req.nextUrl.searchParams.get("status");

  console.log("Auth callback received:", { code, client, requestToken, action, status });

  // Redirect to dashboard with code/request_token in URL params
  const redirectUrl = new URL("/dashboard", req.url);
  if (code) redirectUrl.searchParams.set("code", code);
  if (client) redirectUrl.searchParams.set("client", client);
  if (requestToken) {
    redirectUrl.searchParams.set("request_token", requestToken);
    redirectUrl.searchParams.set("broker", "zerodha");
  }

  return NextResponse.redirect(redirectUrl);
}
