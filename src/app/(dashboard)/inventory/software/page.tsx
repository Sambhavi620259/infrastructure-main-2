"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Software Licenses is no longer a separate area; old links go to /assets/software. */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/assets/software");
  }, [router]);
  return null;
}
