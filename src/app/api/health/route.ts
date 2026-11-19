import { NextResponse } from "next/server";

const BACKEND_API_URL = (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

export const dynamic = "force-dynamic";

/** Reports the UI as healthy only when the backend (and its database) answers too. */
export async function GET() {
  let backend: "ok" | "unavailable" = "unavailable";
  try {
    const response = await fetch(`${BACKEND_API_URL}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) backend = "ok";
  } catch {
    // Backend unreachable or timed out.
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
