"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  BriefcaseIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  CameraIcon,
  ClockIcon,
  EnvelopeIcon,
  HashtagIcon,
  IdentificationIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import {
  changePassword,
  getMyActivity,
  getProfile,
  removeAvatar,
  resizePhoto,
  updateProfile,
  uploadAvatar,
  type Profile,
  type ProfileActivity,
} from "@/lib/profile";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  IT_ADMIN: "IT Admin",
  SUB_ADMIN: "Sub-admin",
  REPORTING_USER: "Reporting User",
  IT_AGENT: "User",
};

const ROLE_SUMMARY: Record<string, string> = {
  SUPER_ADMIN: "Manages organizations, subscriptions and platform administrators.",
  IT_ADMIN: "Runs your organization's IT: users, assets, inventory, tickets and settings.",
  SUB_ADMIN: "Administers the IT modules assigned to you.",
  REPORTING_USER: "Read-only access to reports and exports.",
  IT_AGENT: "Raises tickets, requests stock and keeps asset status up to date.",
};

const QUICK_LINKS: Record<string, [string, string][]> = {
  SUPER_ADMIN: [
    ["/super-admin", "Platform overview"],
    ["/super-admin/companies", "Companies"],
    ["/super-admin/audit", "Audit logs"],
  ],
  IT_ADMIN: [
    ["/dashboard", "Dashboard"],
    ["/tickets", "Ticket queue"],
    ["/users", "Users"],
    ["/settings", "Organization settings"],
  ],
  SUB_ADMIN: [
    ["/dashboard", "Dashboard"],
    ["/assets", "Assets"],
    ["/reports", "Reports"],
  ],
  REPORTING_USER: [
    ["/reports", "Reports"],
    ["/dashboard", "Dashboard"],
  ],
  IT_AGENT: [
    ["/agent/dashboard", "My dashboard"],
    ["/agent/tickets", "My tickets"],
    ["/agent/assets", "My assets"],
    ["/agent/inventory", "Request stock"],
  ],
};

const ACTION_LABEL: Record<string, string> = {
  USER_LOGIN: "Signed in",
  USER_REGISTER: "Created this account",
  UPDATE_PROFILE: "Updated profile",
  UPDATE_PROFILE_PHOTO: "Changed profile photo",
  REQUEST_INVENTORY: "Requested stock",
  PROCESS_INVENTORY_REQUEST: "Decided a stock request",
  CREATE_INVENTORY_ITEM: "Added a stock item",
  DELETE_ASSET: "Removed an asset",
  CREATE_USER: "Created a user",
  UPDATE_USER: "Updated a user",
  CHANGE_PASSWORD: "Changed password",
  CREATE_ASSET_REQUEST: "Raised a ticket",
  PROCESS_ASSET_REQUEST: "Processed a ticket",
  ASSIGN_ASSET: "Assigned an asset",
  UNASSIGN_ASSET: "Returned an asset to stock",
  UPDATE_ASSET: "Updated an asset",
  CREATE_ASSET: "Registered an asset",
  ADJUST_INVENTORY_STOCK: "Adjusted stock",
  GENERATE_REPORT: "Generated a report",
  CREATE_MAINTENANCE: "Logged a repair",
  UPDATE_MAINTENANCE: "Updated a repair",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sentenceCase(action: string): string {
  const text = action.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<ProfileActivity[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    getProfile()
      .then(setProfile)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load your profile."));
    getMyActivity()
      .then(setActivity)
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  if (!profile) {
    return (
      <main className="mx-auto max-w-6xl space-y-4">
        {error ? (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}{" "}
            <button type="button" onClick={load} className="ml-2 font-semibold underline">
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Loading your profile…</p>
        )}
      </main>
    );
  }

  const roleLabel = ROLE_LABEL[profile.role] ?? sentenceCase(profile.role);
  const organization = profile.organizationName ?? profile.companyName;
  const facts: [typeof EnvelopeIcon, string, string][] = [
    [EnvelopeIcon, "Email", profile.email],
    [PhoneIcon, "Phone", profile.phone ?? "—"],
    [BuildingOffice2Icon, "Organization", organization ?? "—"],
    [HashtagIcon, "Organization ID", profile.organizationId ?? "—"],
    [IdentificationIcon, "Employee ID", profile.employeeId ?? "—"],
    ...(profile.agentId ? ([[IdentificationIcon, "User ID", profile.agentId]] as [typeof EnvelopeIcon, string, string][]) : []),
    [UserGroupIcon, "Department", profile.department ?? "—"],
    [MapPinIcon, "Location", profile.location ?? "—"],
    [CalendarDaysIcon, "Member since", formatDay(profile.memberSince)],
    [ClockIcon, "Previous sign-in", formatDateTime(profile.previousLoginAt)],
  ];

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">Account</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-950">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500">Your photo, details, security and recent activity.</p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="h-24 bg-gradient-to-r from-brand-600 via-blue-500 to-sky-400" aria-hidden="true" />
        <div className="px-6 pb-6">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
            <PhotoEditor profile={profile} onSaved={setProfile} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-2xl font-extrabold text-slate-950">{profile.name}</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-600">
                {profile.jobTitle && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <BriefcaseIcon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    {profile.jobTitle}
                  </span>
                )}
                {profile.jobTitle && organization && <span className="text-slate-300">·</span>}
                {organization && <span>{organization}</span>}
                {!profile.jobTitle && !organization && (
                  <span className="text-slate-500">{ROLE_SUMMARY[profile.role] ?? roleLabel}</span>
                )}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 sm:self-auto">
              <ShieldCheckIcon className="h-4 w-4" aria-hidden="true" />
              {roleLabel}
            </span>
          </div>
          {profile.bio && <p className="mt-4 max-w-3xl whitespace-pre-line text-sm leading-6 text-slate-600">{profile.bio}</p>}
          <dl className="mt-6 grid gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([Icon, label, value]) => (
              <div key={label} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className={`mt-0.5 truncate text-sm font-semibold text-slate-800 ${label.endsWith("ID") ? "font-mono" : ""}`}>
                    {value}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <DetailsForm profile={profile} onSaved={setProfile} />
        <PasswordCard previousLoginAt={profile.previousLoginAt} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="font-bold text-slate-900">Recent activity</h2>
            <p className="mt-0.5 text-xs text-slate-500">What you did most recently, including sign-ins.</p>
          </div>
          {activity.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {activity.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 px-6 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-800">{ACTION_LABEL[entry.action] ?? sentenceCase(entry.action)}</span>
                    {entry.new_value && entry.action !== "USER_LOGIN" && (
                      <span className="text-slate-500"> · {entry.new_value}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(entry.timestamp)}</span>
                </li>
              ))}
            </ol>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-bold text-slate-900">Go to</h2>
          <ul className="mt-3 space-y-1">
            {(QUICK_LINKS[profile.role] ?? []).map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {label}
                  <span aria-hidden="true" className="text-slate-400">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];

function PhotoEditor({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setError("Choose a PNG, JPEG or WebP image.");
    if (file.size > 10 * 1024 * 1024) return setError("That image is larger than 10 MB.");
    setBusy(true);
    setError("");
    try {
      onSaved(await uploadAvatar(await resizePhoto(file)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload the photo.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      onSaved(await removeAvatar());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the photo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0">
      <div className="relative h-24 w-24">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small data URL, not a remote image
          <img
            src={profile.avatarUrl}
            alt={`${profile.name}'s profile photo`}
            className="h-24 w-24 rounded-2xl border-4 border-white object-cover shadow-sm"
          />
        ) : (
          <span className="grid h-24 w-24 place-items-center rounded-2xl border-4 border-white bg-brand-50 text-3xl font-extrabold text-brand-700 shadow-sm">
            {initials(profile.name)}
          </span>
        )}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          aria-label={profile.avatarUrl ? "Change photo" : "Upload photo"}
          className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-brand-600 text-white shadow hover:bg-brand-700 disabled:opacity-60"
        >
          <CameraIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        <input ref={fileInput} type="file" accept={PHOTO_TYPES.join(",")} onChange={choose} className="sr-only" tabIndex={-1} />
      </div>
      <div className="mt-2 flex gap-3 text-xs font-semibold">
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="text-brand-600 hover:text-brand-700">
          {busy ? "Saving…" : profile.avatarUrl ? "Change photo" : "Upload photo"}
        </button>
        {profile.avatarUrl && !busy && (
          <button type="button" onClick={remove} className="text-slate-500 hover:text-slate-700">
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 max-w-[12rem] text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

type DetailsKey = "name" | "jobTitle" | "employeeId" | "phone" | "location" | "organizationName" | "organizationId" | "bio";

function DetailsForm({ profile, onSaved }: { profile: Profile; onSaved: (profile: Profile) => void }) {
  const initial = (): Record<DetailsKey, string> => ({
    name: profile.name,
    jobTitle: profile.jobTitle ?? "",
    employeeId: profile.employeeId ?? "",
    phone: profile.phone ?? "",
    location: profile.location ?? "",
    organizationName: profile.organizationName ?? "",
    organizationId: profile.organizationId ?? "",
    bio: profile.bio ?? "",
  });
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saved = initial();
  const changed = (Object.keys(values) as DetailsKey[]).some((key) => values[key].trim() !== saved[key].trim());
  const set = (key: DetailsKey) => (event: { target: { value: string } }) => {
    setValues((current) => ({ ...current, [key]: event.target.value }));
    setMessage(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (values.name.trim().length < 2) return setMessage({ ok: false, text: "Your name needs at least 2 characters." });
    if (values.phone && !/^[0-9+()\-\s]*$/.test(values.phone)) {
      return setMessage({ ok: false, text: "A phone number can contain digits, spaces, +, - and brackets." });
    }
    setBusy(true);
    try {
      const updated = await updateProfile({
        name: values.name.trim(),
        jobTitle: values.jobTitle.trim(),
        employeeId: values.employeeId.trim(),
        phone: values.phone.trim(),
        location: values.location.trim(),
        organizationName: values.organizationName.trim(),
        organizationId: values.organizationId.trim(),
        bio: values.bio.trim(),
      });
      onSaved(updated);
      setMessage({ ok: true, text: "Profile saved." });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Could not save your profile." });
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
  const field = (key: DetailsKey, label: string, props: { maxLength: number; placeholder?: string; autoComplete?: string; inputMode?: "tel" }) => (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <input value={values[key]} onChange={set(key)} className={inputClass} {...props} />
    </label>
  );

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" noValidate>
      <h2 className="font-bold text-slate-900">Personal details</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Shown on your profile. Your email and role are managed by your administrator.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {field("name", "Full name", { maxLength: 150, autoComplete: "name" })}
        {field("jobTitle", "Job title", { maxLength: 100, placeholder: "e.g. Support Engineer", autoComplete: "organization-title" })}
        {field("organizationName", "Organization name", { maxLength: 150, placeholder: "e.g. Bold And Wise Ventures", autoComplete: "organization" })}
        {field("organizationId", "Organization ID", { maxLength: 60, placeholder: "e.g. BWV-001" })}
        {field("employeeId", "Employee ID", { maxLength: 50, placeholder: "e.g. EMP-1042" })}
        {field("phone", "Phone", { maxLength: 30, placeholder: "e.g. +91 98765 43210", autoComplete: "tel", inputMode: "tel" })}
        {field("location", "Location", { maxLength: 100, placeholder: "e.g. Bengaluru office, 3rd floor" })}
        <label className="block text-sm font-semibold text-slate-700">
          Email
          <input value={profile.email} readOnly className={`${inputClass} bg-slate-50 text-slate-500`} />
        </label>
        <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">
          About me
          <textarea
            value={values.bio}
            onChange={set("bio")}
            maxLength={500}
            rows={3}
            placeholder="A short introduction: your role, team or what people can contact you about."
            className={`${inputClass} resize-y`}
          />
          <span className="mt-1 block text-right text-[11px] font-normal text-slate-400">{values.bio.length}/500</span>
        </label>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-4 text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !changed}
        className="mt-5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

function PasswordCard({ previousLoginAt }: { previousLoginAt: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next.length < 8) return setMessage({ ok: false, text: "The new password needs at least 8 characters." });
    if (next !== confirm) return setMessage({ ok: false, text: "The new passwords do not match." });
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Password changed. Use it the next time you sign in." });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Could not change your password." });
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" noValidate>
      <h2 className="font-bold text-slate-900">Password &amp; security</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Previous sign-in: <strong className="text-slate-700">{formatDateTime(previousLoginAt)}</strong>. If that wasn&rsquo;t
        you, change your password now.
      </p>
      <div className="mt-5 space-y-4">
        <label className="block text-sm font-semibold text-slate-700">
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            New password
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </label>
        </div>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`mt-4 text-sm ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !current || !next}
        className="mt-5 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
