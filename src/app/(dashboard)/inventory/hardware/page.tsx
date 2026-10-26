"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Hardware Stock is no longer a separate area; old links go to /assets/hardware. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/assets/hardware");
  }, [router]);
  return null;
}
