"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");

    setError("");
    setSuccess("");
    setSubmitting(true);

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSuccess("If the email exists, a password reset link has been sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to process request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6">
      <section className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-sm font-black text-white">B</span>
          <div>
            <p className="font-extrabold text-slate-950">Bold And Wise</p>
            <p className="text-[10px] font-bold tracking-wider text-brand-600">IT ASSET MANAGEMENT</p>
          </div>
        </div>

        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-slate-950">Reset your password</h1>
        <p className="mt-2 text-sm text-slate-500">Enter your email and we&rsquo;ll send you a reset link.</p>

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <label className="block text-sm font-semibold text-slate-700">
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending..." : "Send reset link"}
          </button>

          <p className="mt-6 text-center text-sm text-slate-500">
            <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700 hover:underline">Back to sign in</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
