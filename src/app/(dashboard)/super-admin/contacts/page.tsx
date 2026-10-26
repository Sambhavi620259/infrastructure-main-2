"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** This page no longer exists (Company contact details are in Settings); old links go to Settings. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/super-admin/settings");
  }, [router]);
  return null;
}
