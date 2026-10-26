"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** My Access now lives under My Assets; this keeps old links and notifications working. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agent/assets?tab=access");
  }, [router]);
  return null;
}
