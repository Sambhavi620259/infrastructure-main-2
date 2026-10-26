"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** My Software now lives under My Assets; this keeps old links and notifications working. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agent/assets?tab=software");
  }, [router]);
  return null;
}
