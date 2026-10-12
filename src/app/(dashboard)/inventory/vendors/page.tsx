"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createVendor, listVendors, updateVendor, type Vendor } from "@/lib/procurement";

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listVendors()
      .then((data) => {
        if (!cancelled) setVendors(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load vendors.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const toggle = async (vendor: Vendor) => {
    try {
      const updated = await updateVendor(vendor.id, { status: vendor.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      setNotice(`${updated.name} is now ${updated.status.toLowerCase()}.`);
      setRefreshKey((key) => key + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed.");
    }
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Inventory · Vendors</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Vendors</h1>
          <p className="mt-1 text-sm text-slate-500">Suppliers you buy hardware, software and services from.</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={formOpen}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          Add vendor
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {formOpen && (
        <VendorForm
          onCancel={() => setFormOpen(false)}
          onSaved={(vendor) => {
            setFormOpen(false);
            setNotice(`Vendor ${vendor.name} added.`);
            setError("");
            setRefreshKey((key) => key + 1);
          }}
        />
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Vendor", "Contact", "Email", "Phone", "GST", "Status", ""].map((heading) => (
                  <th key={heading} className="px-5 py-3">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="text-sm hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-800">{vendor.name}</p>
                    {vendor.address && <p className="text-xs text-slate-500">{vendor.address}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{vendor.contact ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{vendor.email ?? "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{vendor.phone ?? "—"}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{vendor.gst ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                        vendor.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {vendor.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button type="button" onClick={() => toggle(vendor)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                      {vendor.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && vendors.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">No vendors yet. Add the suppliers you buy from.</p>
        )}
      </section>
    </main>
  );
}

function VendorForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: (vendor: Vendor) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "").trim() || undefined;
    const name = text("name");
    if (!name) return setError("Enter the vendor name.");
    setBusy(true);
    try {
      onSaved(
        await createVendor({
          name,
          contact: text("contact"),
          email: text("email"),
          phone: text("phone"),
          gst: text("gst"),
          address: text("address"),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the vendor.");
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal";
  const fields: [string, string, string][] = [
    ["name", "Vendor name", "e.g. Dell India"],
    ["contact", "Contact person", ""],
    ["email", "Email", "sales@vendor.com"],
    ["phone", "Phone", ""],
    ["gst", "GST number", ""],
    ["address", "Address", ""],
  ];

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-base font-extrabold text-slate-900">Add vendor</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className="block text-xs font-semibold text-slate-600">
            {label}
            <input name={key} type={key === "email" ? "email" : "text"} placeholder={placeholder} className={inputClass} />
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? "Saving…" : "Save vendor"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
