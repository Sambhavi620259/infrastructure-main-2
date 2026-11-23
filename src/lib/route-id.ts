"use client";

import { usePathname } from "next/navigation";

/**
 * The record id taken from the browser's own address (the last path segment), e.g. /tickets/<id>.
 *
 * The static build (S3 + CloudFront) ships one placeholder page per detail route (/tickets/_),
 * and CloudFront serves it for every id. `useParams()` would then report the placeholder, so
 * pages read the id from the address bar instead. It behaves the same on the Node server.
 */
export function useRouteId(): { id: string } {
  const path = (usePathname() ?? "").replace(/\/+$/, "");
  const segment = path.split("/").pop() ?? "";
  try {
    return { id: decodeURIComponent(segment) };
  } catch {
    return { id: segment };
  }
}
