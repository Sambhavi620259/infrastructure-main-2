"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MyHardware } from "@/components/agent/my-hardware";
import { MySoftware } from "@/components/agent/my-software";
import { MyAccess } from "@/components/agent/my-access";
import { userPageOnPlan } from "@/lib/access";
import { getProfile } from "@/lib/profile";

type Tab = "hardware" | "software" | "access";

const TABS: [Tab, string, string][] = [
  ["hardware", "Hardware", "/agent/assets"],
  ["software", "Software", "/agent/software"],
  ["access", "Access", "/agent/access"],
];

/**
 * Everything a user has or asks for, in one place: hardware, software and
 * access, each with its own request button. Software and access tabs show
 * only when the organization's plan includes them.
 */
export default function MyAssetsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("hardware");
  const [planFeatures, setPlanFeatures] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "software" || wanted === "access") setTab(wanted);
    getProfile()
      .then((profile) => setPlanFeatures(profile.planFeatures))
      .catch(() => undefined);
  }, []);

  const visible = TABS.filter(([, , page]) => userPageOnPlan(page, planFeatures));
  // A tab that is not on the plan falls back to Hardware.
  const current: Tab = visible.some(([value]) => value === tab) ? tab : "hardware";

  // The address bar should match what is shown when a requested tab is not on the plan.
  useEffect(() => {
    if (planFeatures !== undefined && current !== tab) router.replace("/agent/assets", { scroll: false });
  }, [planFeatures, current, tab, router]);

  const choose = (value: Tab) => {
    setTab(value);
    router.replace(value === "hardware" ? "/agent/assets" : `/agent/assets?tab=${value}`, { scroll: false });
  };

  return (
    <main className="mx-auto max-w-[1400px] space-y-4">
      <header>
        <p className="text-[11px] font-semibold text-brand-600">User · Assets</p>
        <h1 className="mt-1 text-2xl font-extrabold">My Assets</h1>
      </header>

      <div role="tablist" aria-label="My assets" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
        {visible.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={current === value}
            onClick={() => choose(value)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 ${current === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {current === "hardware" && <MyHardware />}
      {current === "software" && <MySoftware />}
      {current === "access" && <MyAccess />}
    </main>
  );
}
