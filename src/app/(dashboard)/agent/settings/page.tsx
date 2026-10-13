"use client";

import { useEffect, useState, type FormEvent } from "react";
import { changePassword, getProfile, type Profile } from "@/lib/profile";

const ACCESS = [
  [true, "Raise, approve and reject tickets"],
  [true, "Assign, unassign and update asset status"],
  [true, "Issue and receive inventory stock"],
  [false, "View other users' contact details"],
  [true, "Generate and download reports"],
  [false, "Register assets or edit purchase details"],
  [false, "Create or remove users, roles and subscriptions"],
] as const;

export default function AgentSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getProfile()
      .then(setProfile)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load your profile."));
  }, []);

  const details: [string, string][] = [
    ["Name", profile?.name ?? "—"],
    ["Email", profile?.email ?? "—"],
    ["User ID", profile?.agentId ?? "—"],
    ["Organization", profile?.companyName ?? "—"],
    ["Department", profile?.department ?? "—"],
    ["Role", "User"],
  ];

  return (
    <main className="mx-auto max-w-[1000px] space-y-4">
      <header>
        <p className="text-[11px] font-semibold text-brand-600">User · Settings</p>
        <h1 className="mt-1 text-2xl font-extrabold">My Profile</h1>
        <p className="mt-1 text-xs text-slate-500">Your account details, access, and password.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-2">
        <article className="ui-surface p-5">
          <h2 className="text-sm font-bold">Profile</h2>
          <dl className="mt-4 space-y-3 text-xs">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[10px] text-slate-400">{label}</dt>
                <dd className={`font-semibold ${label === "User ID" ? "font-mono" : ""}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
        <article className="ui-surface p-5">
          <h2 className="text-sm font-bold">Access</h2>
          <ul className="mt-4 space-y-2 text-[11px] text-slate-600">
            {ACCESS.map(([allowed, label]) => (
              <li key={label} className={allowed ? "" : "text-slate-400"}>
                <span aria-hidden="true">{allowed ? "✓ " : "× "}</span>
                <span className="sr-only">{allowed ? "Allowed: " : "Not allowed: "}</span>
                {label}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <PasswordForm />
    </main>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next.length < 8) return setMessage({ ok: false, text: "New password must be at least 8 characters." });
    if (next !== confirm) return setMessage({ ok: false, text: "The new passwords do not match." });
    setBusy(true);
    try {
      await changePassword(current, next);
      setMessage({ ok: true, text: "Password changed. Use it next time you sign in." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Could not change the password." });
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-normal";

  return (
    <form onSubmit={submit} className="ui-surface space-y-3 p-5">
      <h2 className="text-sm font-bold">Change password</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-[11px] font-semibold text-slate-600">
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          New password
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600">
          Confirm new password
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
        </label>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !current}
        className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
