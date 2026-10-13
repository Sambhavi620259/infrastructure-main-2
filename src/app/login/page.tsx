"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightEndOnRectangleIcon,
  EnvelopeIcon,
  EyeIcon,
  EyeSlashIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { ROLE_REDIRECT_MAP, type UserRole } from "@/lib/roles";
import { apiFetch, clearAuth } from "@/lib/api";
import { AuthLayout, IconField } from "@/components/auth/auth-layout";

type LoginResponse = { access_token: string; role: UserRole };
const validRoles: readonly UserRole[] = ["IT_AGENT", "IT_ADMIN", "SUPER_ADMIN"];

// "Remember me" keeps the email and role on this device; it never stores the password.
const REMEMBER_KEY = "itam-remembered-login";

function readRemembered(): { email: string; role: UserRole } | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(REMEMBER_KEY) ?? "null");
    if (saved && typeof saved.email === "string" && validRoles.includes(saved.role)) return saved;
  } catch {
    // Storage unavailable or corrupt: behave as if nothing was remembered.
  }
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<UserRole>("IT_ADMIN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill from a remembered login, then from links such as
  // /login?email=a@b.com&role=IT_AGENT (used after agent registration), which win.
  useEffect(() => {
    const saved = readRemembered();
    if (saved) {
      setEmail(saved.email);
      setRole(saved.role);
      setRemember(true);
    }
    const params = new URLSearchParams(window.location.search);
    const presetRole = params.get("role") as UserRole | null;
    if (presetRole && validRoles.includes(presetRole)) setRole(presetRole);
    const presetEmail = params.get("email");
    if (presetEmail) setEmail(presetEmail);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setError("");
    setSubmitting(true);
    try {
      clearAuth();
      const data = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      const authenticatedRole = validRoles.includes(data.role) ? data.role : role;
      localStorage.setItem("auth-token", data.access_token);
      // Matches the 12-hour token lifetime (ACCESS_TOKEN_EXPIRE_MINUTES).
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `auth-token=${encodeURIComponent(data.access_token)}; Path=/; Max-Age=43200; SameSite=Lax${secure}`;
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, role: authenticatedRole }));
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // Not being able to remember the email must not block sign-in.
      }
      router.replace(ROLE_REDIRECT_MAP[authenticatedRole]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">Welcome Back</h2>
      <p className="mt-2 text-slate-500">Sign in to access your IT Asset Management account</p>

      <form className="mt-8 space-y-5" onSubmit={submit} noValidate>
        <label className="block text-sm font-semibold text-slate-700">
          Login Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base font-normal text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="IT_AGENT">User</option>
            <option value="IT_ADMIN">IT Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>

        <IconField
          label="Email Address"
          icon={EnvelopeIcon}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />

        <IconField
          label="Password"
          icon={LockClosedIcon}
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="rounded p-1 text-slate-400 hover:text-slate-600"
            >
              {showPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
            </button>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Remember Me
          </label>
          <Link href="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            Forgot Password?
          </Link>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <button
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ArrowRightEndOnRectangleIcon className="h-5 w-5" aria-hidden="true" />
          {submitting ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <p className="mt-8 border-t border-slate-100 pt-6 text-center text-sm text-slate-500">
        Don&rsquo;t have an account?{" "}
        <Link href="/register" className="font-bold text-brand-600 hover:text-brand-700">
          Register
        </Link>
      </p>
    </AuthLayout>
  );
}
