"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Inventory is no longer part of the user workspace; send old links to the dashboard. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agent/dashboard");
  }, [router]);
  return null;
}
