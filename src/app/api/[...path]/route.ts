import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_URL = (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  // request.nextUrl.search carries the query string ("" when there is none).
  // Without it every filter, search term and pagination parameter is dropped.
  const target = `${BACKEND_API_URL}/api/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();

  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");
  if (contentType) headers.set("content-type", contentType);
  if (authorization) headers.set("authorization", authorization);
  // A visitor can send any X-Forwarded-For they like, so it is passed on only
  // when TRUST_FORWARDED_HEADERS=true, i.e. when a reverse proxy in front of
  // this server sets (and overwrites) the header. Otherwise it is dropped and the
  // backend sees this server's own address, which a visitor cannot forge.
  if (process.env.TRUST_FORWARDED_HEADERS === "true") {
    const forwardedFor = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
    if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const responseContentType = response.headers.get("content-type");
    if (responseContentType) responseHeaders.set("content-type", responseContentType);

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json(
      { detail: "The application API is unavailable. Make sure the backend is running." },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
