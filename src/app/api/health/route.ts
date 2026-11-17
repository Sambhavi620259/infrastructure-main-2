import { NextResponse } from "next/server";

const BACKEND_API_URL = (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

/**
 * Health of the app as a visitor would meet it: this server is up, and so is the
 * API behind it (which also checks its database). 503 when the API cannot be reached.
 */
export async function GET() {
  let backend: "ok" | "unreachable" = "unreachable";
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) backend = "ok";
  } catch {
    // Left as unreachable.
  }
  return NextResponse.json(
    {
      status: backend === "ok" ? "ok" : "degraded",
      service: "assetops-itam-ui",
      backend,
      timestamp: new Date().toISOString(),
    },
    { status: backend === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
