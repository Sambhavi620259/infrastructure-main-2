import { NextRequest, NextResponse } from "next/server";

const BACKEND_API_URL = (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
// Same limit as the backend's MAX_REQUEST_BODY_BYTES; larger uploads are refused here, before being forwarded.
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
// Shared with the API (PROXY_SHARED_SECRET there): proves this request came from this proxy,
// so the API believes the visitor address below.
const PROXY_KEY = process.env.BACKEND_PROXY_KEY || "";

/**
 * The visitor's address for the backend's per-client limits. Only values a platform
 * proxy sets are used: Vercel's own header, else the last X-Forwarded-For entry (the one
 * the nearest proxy added). A value the browser sent itself, such as the first entry, is ignored.
 */
function visitorAddress(request: NextRequest): string | null {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

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
  // Pass the visitor's address on, so per-client limits (e.g. sign-in attempts)
  // apply per person rather than to the proxy as a whole.
  const visitor = visitorAddress(request);
  if (visitor) headers.set("x-forwarded-for", visitor);
  if (PROXY_KEY) {
    headers.set("x-itam-proxy-key", PROXY_KEY);
    if (visitor) headers.set("x-itam-client-ip", visitor);
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json({ detail: "The request is too large (limit 8 MB)." }, { status: 413 });
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ detail: "The request is too large (limit 8 MB)." }, { status: 413 });
    }
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const responseHeaders = new Headers();
    // Downloads (e.g. ticket attachments) keep their file name and no-sniff header.
    for (const name of ["content-type", "content-disposition", "x-content-type-options", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json({ detail: "The application API took too long to answer. Try again." }, { status: 504 });
    }
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
