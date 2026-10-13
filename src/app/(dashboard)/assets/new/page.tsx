"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AssetForm,
  emptyAssetForm,
  formFromReceipt,
  formToPayload,
  formToSoftware,
  isSoftwareLicense,
  type AssetFormValues,
} from "@/components/assets/asset-form";
import { createAsset } from "@/lib/assets";
import { listReceipts, type StockReceipt } from "@/lib/inventory";
import { createSoftware } from "@/lib/software";

export default function NewAssetPage() {
  const router = useRouter();
  const [initial, setInitial] = useState(emptyAssetForm);
  const [receipt, setReceipt] = useState<StockReceipt | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // /assets/new?receipt=<id>: register one device from a stock receipt.
  useEffect(() => {
    const receiptId = new URLSearchParams(window.location.search).get("receipt");
    if (!receiptId) return;
    listReceipts()
      .then((receipts) => {
        const found = receipts.find((r) => r.id === receiptId) ?? null;
        if (!found) return setError("That stock receipt was not found.");
        setReceipt(found);
        setInitial(formFromReceipt(found));
        setFormKey((key) => key + 1);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the stock receipt."));
  }, []);

  const submit = async (values: AssetFormValues) => {
    setError("");
    setSubmitting(true);
    try {
      if (!receipt && isSoftwareLicense(values)) {
        const created = await createSoftware(formToSoftware(values));
        router.push(`/assets/software?product=${created.id}`);
        return;
      }
      // Create takes optional fields as absent rather than null.
      const payload = Object.fromEntries(Object.entries(formToPayload(values)).filter(([, value]) => value !== null));
      const created = await createAsset({
        ...payload,
        name: values.name.trim(),
        category: values.category,
        asset_tag: values.asset_tag.trim() || undefined,
        serial_number: values.serial_number.trim() || undefined,
        receipt_id: receipt?.id,
      });
      router.push(`/assets/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to register this asset.");
      setSubmitting(false);
    }
  };

  const left = receipt ? receipt.quantity - receipt.registered : 0;

  return (
    <main className="mx-auto max-w-6xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Assets · Register</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Add a new asset</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose Hardware device (one record per physical device) or Software license (with its License Number and License
          Count). Only the name is required.
        </p>
      </header>

      {receipt && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Registering a device from receipt on <strong>{receipt.po_number}</strong>:{" "}
          {receipt.quantity} × {[receipt.brand, receipt.model].filter(Boolean).join(" ") || receipt.category} ·{" "}
          <strong>{left}</strong> still to register.{" "}
          <Link href="/inventory/hardware" className="font-semibold underline">
            Back to Hardware Stock
          </Link>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </div>
      )}

      <AssetForm
        key={formKey}
        initial={initial}
        creating
        busy={submitting}
        submitLabel="Register asset"
        onSubmit={submit}
        onCancel={() => router.push(receipt ? "/inventory/hardware" : "/assets")}
        receipt={receipt}
      />
    </main>
  );
}
