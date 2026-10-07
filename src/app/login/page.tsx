"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_REDIRECT_MAP, type UserRole } from "@/lib/roles";
import { apiFetch, clearAuth } from "@/lib/api";

type LoginResponse = { access_token: string; role: UserRole };
const validRoles: readonly UserRole[] = ["IT_AGENT", "IT_ADMIN", "SUPER_ADMIN"];

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("IT_ADMIN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setError(""); setSubmitting(true);
    try {
      clearAuth();
      const data = await apiFetch<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password, role }) });
      const authenticatedRole = validRoles.includes(data.role) ? data.role : role;
      localStorage.setItem("auth-token", data.access_token);
      document.cookie = `auth-token=${encodeURIComponent(data.access_token)}; Path=/; Max-Age=3600; SameSite=Lax`;
      router.replace(ROLE_REDIRECT_MAP[authenticatedRole]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to sign in."); }
    finally { setSubmitting(false); }
  };

  return <main className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6"><section className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-sm font-black text-white">B</span><div><p className="font-extrabold text-slate-950">Bold And Wise</p><p className="text-[10px] font-bold tracking-wider text-brand-600">IT ASSET MANAGEMENT</p></div></div><h1 className="mt-8 text-2xl font-extrabold tracking-tight text-slate-950">Sign in to your workspace</h1><p className="mt-2 text-sm text-slate-500">Choose the role assigned to your account.</p><form className="mt-6 space-y-4" onSubmit={submit} noValidate><label className="block text-sm font-semibold text-slate-700">Role<select value={role} onChange={(event) => setRole(event.target.value as UserRole)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"><option value="IT_AGENT">IT Agent</option><option value="IT_ADMIN">IT Admin</option><option value="SUPER_ADMIN">Super Admin</option></select></label><label className="block text-sm font-semibold text-slate-700">Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label><label className="block text-sm font-semibold text-slate-700">Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label><p className="text-right"><Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline">Forgot password?</Link></p>{error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}<button disabled={submitting} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Signing in…" : "Sign in"}</button></form><p className="mt-6 text-center text-sm text-slate-500">Need an IT Admin or invited IT Agent account? <Link href="/register" className="font-bold text-brand-600 hover:text-brand-700">Register</Link></p></section></main>;
}
