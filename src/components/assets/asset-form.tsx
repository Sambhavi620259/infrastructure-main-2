"use client";

import { useEffect, useState, type FormEvent } from "react";
import { listAssetCategories, type AssetCategory } from "@/lib/tickets";
import { listDepartments } from "@/lib/users";
import { listVendors, type Vendor } from "@/lib/procurement";
import type { Asset } from "@/types/asset";
import type { Department } from "@/types/user";

export const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;

/** Every editable asset field, as entered in the form (dates as yyyy-mm-dd). */
export interface AssetFormValues {
  asset_tag: string;
  serial_number: string;
  name: string;
  category: string;
  type: string;
  brand: string;
  model: string;
  condition: string;
  department_id: string;
  vendor_id: string;
  location_id: string;
  purchase_date: string;
  purchase_price: string;
  warranty_start: string;
  warranty_end: string;
  description: string;
}

export function emptyAssetForm(): AssetFormValues {
  return {
    asset_tag: "", serial_number: "", name: "", category: "", type: "Hardware", brand: "", model: "", condition: "EXCELLENT",
    department_id: "", vendor_id: "", location_id: "", purchase_date: "", purchase_price: "", warranty_start: "",
    warranty_end: "", description: "",
  };
}

export function assetToForm(asset: Asset): AssetFormValues {
  const day = (value: string | null) => (value ? value.slice(0, 10) : "");
  return {
    asset_tag: asset.asset_tag,
    serial_number: asset.serial_number,
    name: asset.name,
    category: asset.category,
    type: asset.type ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    condition: asset.condition ?? "EXCELLENT",
    department_id: asset.department_id ?? "",
    vendor_id: asset.vendor_id ?? "",
    location_id: asset.location_id ?? "",
    purchase_date: day(asset.purchase_date),
    purchase_price: Number(asset.purchase_price) ? String(Number(asset.purchase_price)) : "",
    warranty_start: day(asset.warranty_start),
    warranty_end: day(asset.warranty_end),
    description: asset.description ?? "",
  };
}

/**
 * Convert form values to an API payload. Optional text becomes null when
 * cleared (so edits can remove a value); dates are sent as midnight.
 */
export function formToPayload(values: AssetFormValues) {
  const text = (value: string) => value.trim() || null;
  const date = (value: string) => (value ? `${value}T00:00:00` : null);
  return {
    name: values.name.trim(),
    category: values.category.trim(),
    type: text(values.type),
    brand: text(values.brand),
    model: text(values.model),
    condition: values.condition,
    department_id: text(values.department_id),
    vendor_id: text(values.vendor_id),
    location_id: text(values.location_id),
    purchase_date: date(values.purchase_date),
    purchase_price: values.purchase_price ? Number(values.purchase_price) : 0,
    warranty_start: date(values.warranty_start),
    warranty_end: date(values.warranty_end),
    description: text(values.description),
  };
}

/** Problems the user can fix before sending; empty when the form is valid. */
export function validateAssetForm(values: AssetFormValues, creating: boolean): string {
  if (creating && (!values.asset_tag.trim() || !values.serial_number.trim())) return "Asset tag and serial number are required.";
  if (!values.name.trim()) return "Give the asset a name.";
  if (!values.category.trim()) return "Choose a category.";
  if (values.purchase_price && !(Number(values.purchase_price) >= 0)) return "Purchase price must be zero or more.";
  if (values.warranty_start && values.warranty_end && values.warranty_end < values.warranty_start) {
    return "Warranty end must be after warranty start.";
  }
  return "";
}

export function AssetForm({
  initial,
  creating,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: AssetFormValues;
  creating: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AssetFormValues>(initial);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    listAssetCategories().then(setCategories).catch(() => undefined);
    listDepartments().then(setDepartments).catch(() => undefined);
    listVendors()
      .then((data) => setVendors(data.filter((vendor) => vendor.status === "ACTIVE" || vendor.id === initial.vendor_id)))
      .catch(() => undefined);
  }, [initial.vendor_id]);

  const set = (key: keyof AssetFormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateAssetForm(values, creating);
    setError(problem);
    if (!problem) onSubmit(values);
  };

  // Keep a category the asset already has even if it is not in the list.
  const categoryNames = categories.map((c) => c.name);
  if (values.category && !categoryNames.includes(values.category)) categoryNames.unshift(values.category);

  const input = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 read-only:bg-slate-50 read-only:text-slate-500";
  const label = "block text-xs font-bold text-slate-700";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white shadow-sm" noValidate>
      <Fieldset title="Identity" hint="Tag and serial number identify the asset and cannot be changed later.">
        <label className={label}>
          Name <Required />
          <input value={values.name} onChange={set("name")} maxLength={150} placeholder="e.g. ThinkPad T14 Gen 4" className={input} />
        </label>
        <label className={label}>
          Asset tag <Required />
          <input value={values.asset_tag} onChange={set("asset_tag")} readOnly={!creating} maxLength={100} placeholder="e.g. AST-0142" className={input} />
        </label>
        <label className={label}>
          Serial number <Required />
          <input value={values.serial_number} onChange={set("serial_number")} readOnly={!creating} maxLength={100} className={input} />
        </label>
        <label className={label}>
          Category <Required />
          <select value={values.category} onChange={set("category")} className={input}>
            <option value="">Choose…</option>
            {categoryNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Type
          <select value={values.type} onChange={set("type")} className={input}>
            {["Hardware", "Software", "Accessory", "Peripheral", "Network", "Other"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Condition
          <select value={values.condition} onChange={set("condition")} className={input}>
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition.charAt(0) + condition.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Brand
          <input value={values.brand} onChange={set("brand")} maxLength={100} placeholder="e.g. Lenovo" className={input} />
        </label>
        <label className={label}>
          Model
          <input value={values.model} onChange={set("model")} maxLength={100} className={input} />
        </label>
      </Fieldset>

      <Fieldset title="Ownership & location">
        <label className={label}>
          Department
          <select value={values.department_id} onChange={set("department_id")} className={input}>
            <option value="">Not assigned</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Location
          <input value={values.location_id} onChange={set("location_id")} placeholder="e.g. Pune office, floor 2" className={input} />
        </label>
      </Fieldset>

      <Fieldset title="Purchase & warranty" hint="Needed for depreciation, finance and warranty alerts.">
        <label className={label}>
          Purchase date
          <input type="date" value={values.purchase_date} onChange={set("purchase_date")} className={input} />
        </label>
        <label className={label}>
          Purchase price
          <input type="number" min={0} step="0.01" value={values.purchase_price} onChange={set("purchase_price")} className={input} />
        </label>
        <label className={label}>
          Vendor
          <select value={values.vendor_id} onChange={set("vendor_id")} className={input}>
            <option value="">Not specified</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Warranty start
          <input type="date" value={values.warranty_start} onChange={set("warranty_start")} className={input} />
        </label>
        <label className={label}>
          Warranty end
          <input type="date" value={values.warranty_end} onChange={set("warranty_end")} className={input} />
        </label>
      </Fieldset>

      <div className="px-5 pb-5">
        <label className={label}>
          Description
          <textarea value={values.description} onChange={set("description")} rows={3} className={input} />
        </label>
      </div>

      {error && (
        <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 px-5 py-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Required() {
  return (
    <span className="text-rose-500" aria-hidden="true">
      *
    </span>
  );
}

function Fieldset({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-b border-slate-100 px-5 py-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="text-sm font-extrabold text-slate-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}
