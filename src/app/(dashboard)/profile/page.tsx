"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { UserProfile, UserRole } from "@/lib/roles";

type Card = { label: string; value: string; detail: string; href?: string };

const roleCards: Record<UserRole, Card[]> = {
  IT_AGENT: [
    {
      label: "Active ticket assignments",
      value: "12",
      detail: "4 high-priority tickets are in progress.",
      href: "/agent/tickets",
    },
    { label: "Resolution metrics", value: "94%", detail: "First-contact resolution this month." },
    {
      label: "Assigned support queue",
      value: "Endpoint Support",
      detail: "Primary queue · 18 waiting tickets.",
      href: "/agent/tickets",
    },
  ],
  IT_ADMIN: [
    {
      label: "Hardware inventory",
      value: "3,248",
      detail: "Managed hardware assets.",
      href: "/inventory/hardware",
    },
    {
      label: "Software inventory",
      value: "1,184",
      detail: "Tracked software titles and licenses.",
      href: "/inventory/software",
    },
    { label: "Department users", value: "286", detail: "Active users in your organization.", href: "/users" },
    {
      label: "IT activity logs",
      value: "View logs",
      detail: "Review administrative and asset events.",
      href: "/assets/history",
    },
  ],
  SUPER_ADMIN: [
    {
      label: "Companies",
      value: "42",
      detail: "Active tenants across the platform.",
      href: "/super-admin/companies",
    },
    {
      label: "Global subscription",
      value: "Healthy",
      detail: "97.8% of subscriptions are in good standing.",
      href: "/super-admin/subscriptions",
    },
    {
      label: "Platform audit logs",
      value: "View logs",
      detail: "Review tenant and privileged actions.",
      href: "/super-admin/audit",
    },
  ],
};

async function loadProfile(): Promise<UserProfile> {
  const data = await apiFetch<{ user: UserProfile }>("/api/profile");
  return data.user;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch(() => undefined);
  }, []);
  if (!profile)
    return (
      <main className="mx-auto max-w-6xl">
        <p className="text-sm text-slate-500">Loading your profile…</p>
      </main>
    );
  const cards = roleCards[profile.role];

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">Account</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your identity and role-specific workspace summary.</p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-brand-100 text-xl font-extrabold text-brand-700">
            {profile.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-slate-950">{profile.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{profile.email}</p>
          </div>
          <span className="sm:ml-auto rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-brand-700">
            {profile.role.replace("_", " ")}
          </span>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Department</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800">{profile.department ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Company ID</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800">{profile.companyId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Access role</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-800">{profile.role.replace("_", " ")}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h2 className="text-lg font-extrabold text-slate-950">{profile.role.replace("_", " ")} workspace</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">{card.label}</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-950">{card.value}</p>
              <p className="mt-2 text-sm leading-5 text-slate-500">{card.detail}</p>
              {card.href && (
                <Link
                  href={card.href}
                  className="mt-4 inline-block text-sm font-bold text-brand-600 hover:text-brand-700"
                >
                  Open workspace →
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
