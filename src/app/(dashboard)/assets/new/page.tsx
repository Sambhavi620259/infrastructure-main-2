"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old address: hardware and software now have their own create pages. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    router.replace(params.get("type") === "software" ? "/assets/software/new" : `/assets/hardware/new${window.location.search}`);
  }, [router]);
  return null;
}
