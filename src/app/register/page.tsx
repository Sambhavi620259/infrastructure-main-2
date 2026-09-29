"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type RegistrationRole = "IT_ADMIN" | "IT_AGENT" | "SUPER_ADMIN";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<RegistrationRole>("IT_ADMIN");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationToken, setInvitationToken] = useState("");
  const [registrationKey, setRegistrationKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (role === "IT_AGENT" && !invitationToken.trim()) return setError("An invitation token is required for IT Agents.");
    if (role === "SUPER_ADMIN" && !registrationKey.trim()) return setError("A Super Admin registration key is required.");
    setError(""); setSubmitting(true);
    try {
      await apiFetch(role === "IT_AGENT" ? "/api/admin/invite/complete" : "/api/auth/register", { method: "POST", body: JSON.stringify(role === "IT_AGENT" ? { name, email, password, invitationToken } : { name, email, password, role, registrationKey: role === "SUPER_ADMIN" ? registrationKey : undefined }) });
      router.replace("/login");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create your account."); }
    finally { setSubmitting(false); }
  };

  return <main className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6"><section className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8"><p className="text-xs font-bold uppercase tracking-wider text-brand-600">Account registration</p><h1 className="mt-2 text-2xl font-extrabold text-slate-950">Join your IT workspace</h1><p className="mt-2 text-sm text-slate-500">Admins can sign up directly. Agents need an invitation.</p><form className="mt-6 space-y-4" onSubmit={submit} noValidate><label className="block text-sm font-semibold text-slate-700">Account type<select value={role} onChange={(event) => setRole(event.target.value as RegistrationRole)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-brand-500"><option value="IT_ADMIN">IT Admin</option><option value="IT_AGENT">IT Agent (invitation required)</option><option value="SUPER_ADMIN">Super Admin (setup key required)</option></select></label><label className="block text-sm font-semibold text-slate-700">Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500" /></label><label className="block text-sm font-semibold text-slate-700">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500" /></label><label className="block text-sm font-semibold text-slate-700">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500" /></label>{role === "SUPER_ADMIN" && <label className="block text-sm font-semibold text-slate-700">Super Admin Setup Key<input type="password" value={registrationKey} onChange={(event) => setRegistrationKey(event.target.value)} autoComplete="off" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500" /></label>}{role === "IT_AGENT" && <label className="block text-sm font-semibold text-slate-700">Invitation Token<input required value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500" /></label>}{error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}<button disabled={submitting} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60">{submitting ? "Creating account…" : "Create account"}</button></form><p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link href="/login" className="font-bold text-brand-600">Sign in</Link></p></section></main>;
}
