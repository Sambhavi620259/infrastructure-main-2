"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AssetForm, emptyAssetForm, formToPayload, type AssetFormValues } from "@/components/assets/asset-form";
import { createAsset } from "@/lib/assets";

export default function NewAssetPage() {
  const router = useRouter();
  const [initial] = useState(emptyAssetForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (values: AssetFormValues) => {
    setError("");
    setSubmitting(true);
    // Create takes optional fields as absent rather than null.
    const payload = Object.fromEntries(Object.entries(formToPayload(values)).filter(([, value]) => value !== null));
    try {
      const created = await createAsset({
        ...payload,
        name: values.name.trim(),
        category: values.category,
        asset_tag: values.asset_tag.trim(),
        serial_number: values.serial_number.trim(),
      });
      router.push(`/assets/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register this asset.");
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Register</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Add a new asset</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register a hardware or software asset. Purchase and warranty details drive depreciation and warranty alerts.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      <AssetForm
        initial={initial}
        creating
        busy={submitting}
        submitLabel="Register asset"
        onSubmit={submit}
        onCancel={() => router.push("/assets")}
      />
    </main>
  );
}
