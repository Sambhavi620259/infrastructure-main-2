"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightStartOnRectangleIcon } from "@heroicons/react/24/outline";
import { createAssetRequest, listAssetCategories, type AssetCategory } from "@/lib/tickets";
import { CategoryPicker, resolveCategoryId } from "@/components/tickets/category-picker";
import { listDepartments } from "@/lib/users";
import type { Department } from "@/types/user";

export default function NewTicketPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAssetCategories()
      .then((data) => {
        if (!cancelled) setCategories(data);
      })
      .catch(() => undefined);
    listDepartments()
      .then((data) => {
        if (!cancelled) setDepartments(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim();

    // The API stores one text field, so keep both the subject and the details.
    const subject = text("subject");
    const details = text("details");
    if (!subject) return setError("Enter a subject.");

    setError("");
    setSubmitting(true);
    try {
      const assetCategoryId = await resolveCategoryId(categories, categoryId, categoryDraft, (category) =>
        setCategories((current) => [...current, category]),
      );
      if (!assetCategoryId) {
        setError("Choose a category, or type a name for a new one.");
        setSubmitting(false);
        return;
      }
      await createAssetRequest({
        asset_category_id: assetCategoryId,
        department_id: text("department_id") || undefined,
        reason: details ? `${subject}\n\n${details}` : subject,
        priority: text("priority") || "MEDIUM",
      });
      setSuccess(true);
      setTimeout(() => router.push("/tickets"), 1500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create ticket.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Tickets · Create</p>
        <h1 className="mt-1 text-2xl font-extrabold">Create a New Ticket</h1>
        <p className="mt-1 text-sm text-slate-500">Request an asset or report an issue for the IT team.</p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <ArrowRightStartOnRectangleIcon className="h-5 w-5 flex-shrink-0" />
          <span>Ticket submitted successfully. Redirecting…</span>
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white shadow-sm" noValidate>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">
            Asset Category <span className="text-rose-500">*</span>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              draft={categoryDraft}
              onDraftChange={setCategoryDraft}
              selectClassName="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500"
            />
          </label>

          <label className="text-xs font-bold text-slate-700">
            Department
            <select
              name="department_id"
              defaultValue=""
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500"
            >
              <option value="">Not specified</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Priority <span className="text-rose-500">*</span>
            <select
              required
              name="priority"
              defaultValue="MEDIUM"
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700 md:col-span-2">
            Subject <span className="text-rose-500">*</span>
            <input
              required
              name="subject"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="Brief summary of the request"
            />
          </label>

          <label className="text-xs font-bold text-slate-700 md:col-span-2">
            Description
            <textarea
              name="details"
              rows={5}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              placeholder="Detailed description of the issue or request"
            />
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <Link
            href="/tickets"
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Link>
          <button type="submit" disabled={submitting} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
            {submitting ? "Submitting…" : "Submit Ticket"}
          </button>
        </div>
      </form>
    </main>
  );
}