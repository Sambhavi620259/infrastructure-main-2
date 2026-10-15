"use client";

import { useEffect, useState, type FormEvent } from "react";
import { listAssetCategories, type AssetCategory } from "@/lib/tickets";
import { listDepartments } from "@/lib/users";
import { listVendors, type Vendor } from "@/lib/procurement";
import { LICENSE_TYPES, licenseTypeLabel, type SoftwareInput } from "@/lib/software";
import type { StockReceipt } from "@/lib/inventory";
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
  specifications: string;
  condition: string;
  department_id: string;
  vendor_id: string;
  location_id: string;
  purchase_date: string;
  purchase_price: string;
  warranty_start: string;
  warranty_end: string;
  description: string;
  // Software licenses only.
  license_type: string;
  license_number: string;
  license_count: string;
  license_expiry: string;
  license_renewal: string;
}

export function emptyAssetForm(): AssetFormValues {
  return {
    asset_tag: "", serial_number: "", name: "", category: "", type: "Hardware", brand: "", model: "", specifications: "",
    condition: "EXCELLENT", department_id: "", vendor_id: "", location_id: "", purchase_date: "", purchase_price: "",
    warranty_start: "", warranty_end: "", description: "", license_type: "PERPETUAL", license_number: "",
    license_count: "", license_expiry: "", license_renewal: "",
  };
}

/** Prefill a new device from the stock receipt it is registered from. */
export function formFromReceipt(receipt: StockReceipt): AssetFormValues {
  return {
    ...emptyAssetForm(),
    name: [receipt.brand, receipt.model].filter(Boolean).join(" ") || receipt.category,
    category: receipt.category,
    brand: receipt.brand ?? "",
    model: receipt.model ?? "",
    specifications: receipt.specifications ?? "",
    location_id: receipt.location ?? "",
    purchase_price: receipt.unit_cost ? String(receipt.unit_cost) : "",
  };
}

export function assetToForm(asset: Asset): AssetFormValues {
  const day = (value: string | null) => (value ? value.slice(0, 10) : "");
  return {
    ...emptyAssetForm(),
    asset_tag: asset.asset_tag ?? "",
    serial_number: asset.serial_number ?? "",
    name: asset.name,
    category: asset.category === "Uncategorised" ? "" : asset.category,
    // Existing records are devices; the type is set automatically.
    type: "Hardware",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    specifications: asset.specifications ?? "",
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
 * Convert form values to an API payload for a hardware asset. Optional text
 * becomes null when cleared (so edits can remove a value); dates are sent as
 * midnight. A blank asset tag is sent as "" (no tag).
 */
export function formToPayload(values: AssetFormValues) {
  const text = (value: string) => value.trim() || null;
  const date = (value: string) => (value ? `${value}T00:00:00` : null);
  return {
    asset_tag: values.asset_tag.trim(),
    serial_number: text(values.serial_number),
    name: values.name.trim(),
    // Blank is stored as "Uncategorised".
    category: values.category.trim(),
    // Set automatically from the Hardware / Software choice.
    type: "Hardware",
    brand: text(values.brand),
    model: text(values.model),
    specifications: text(values.specifications),
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

/** Payload for registering a software license (product + its first license). */
export function formToSoftware(values: AssetFormValues): SoftwareInput {
  const date = (value: string) => (value ? `${value}T00:00:00` : undefined);
  return {
    name: values.name.trim(),
    vendor: values.brand.trim() || undefined,
    version: values.model.trim() || undefined,
    license: {
      license_type: values.license_type,
      license_number: values.license_number.trim() || undefined,
      seats: Number(values.license_count),
      purchase_date: date(values.purchase_date),
      expiry_date: date(values.license_expiry),
      renewal_date: date(values.license_renewal),
      cost: values.purchase_price ? Number(values.purchase_price) : 0,
      vendor_id: values.vendor_id || undefined,
      notes: values.description.trim() || undefined,
    },
  };
}

const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-_./]{0,99}$/;
const LICENSE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-_./# ]{2,254}$/;

/** Problems the user can fix before sending; empty when the form is valid. Mirrors the API's checks. */
export function validateAssetForm(values: AssetFormValues, software = false): string {
  if (!values.name.trim()) return software ? "Give the software a name." : "Give the asset a name.";
  if (software) {
    if (!/^\d+$/.test(values.license_count.trim()) || Number(values.license_count) < 1) {
      return "License count must be a whole number of at least 1.";
    }
    if (values.license_number.trim() && !LICENSE_NUMBER_PATTERN.test(values.license_number.trim())) {
      return "A license number is 3-255 letters, digits and - _ . / # characters.";
    }
    if (values.purchase_date && values.license_expiry && values.license_expiry < values.purchase_date) {
      return "Expiry date must be after the purchase date.";
    }
  } else {
    // Only the name is required; tag, serial number and category are optional.
    if (values.asset_tag.trim() && !TAG_PATTERN.test(values.asset_tag.trim())) {
      return "An asset tag uses letters, digits and - _ . / only (no spaces), or leave it blank.";
    }
    if (values.warranty_start && values.warranty_end && values.warranty_end < values.warranty_start) {
      return "Warranty end must be after warranty start.";
    }
  }
  if (values.purchase_price && !(Number(values.purchase_price) >= 0)) return "Purchase price must be zero or more.";
  return "";
}

export function AssetForm({
  initial,
  creating,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  receipt,
  kind = "hardware",
}: {
  initial: AssetFormValues;
  creating: boolean;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
  /** Registering a device from this stock receipt: software mode is not offered. */
  receipt?: StockReceipt | null;
  /** Which record this form creates. Hardware is a device; software is a product with its license. */
  kind?: "hardware" | "software";
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

  // Software is for new records only; existing devices stay devices.
  const software = creating && !receipt && kind === "software";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validateAssetForm(values, software);
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
      <Fieldset
        title="Identity"
        hint={
          software
            ? "Only the name and License Count are required. The software is recorded with its purchased seats."
            : "Only the name is required. Serial number and asset tag are optional; when given they must be unique."
        }
      >
        <label className={label}>
          Name <Required />
          <input value={values.name} onChange={set("name")} maxLength={150} placeholder={software ? "e.g. Microsoft 365" : "e.g. ThinkPad T14 Gen 4"} className={input} />
        </label>
        <label className={label}>
          Category <span className="font-normal text-slate-400">(optional)</span>
          <select value={values.category} onChange={set("category")} className={input}>
            <option value="">Choose…</option>
            {categoryNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {!software && (
          <>
            <label className={label}>
              Asset tag <span className="font-normal text-slate-400">(optional)</span>
              <input value={values.asset_tag} onChange={set("asset_tag")} maxLength={100} placeholder="e.g. AST-0142" className={input} />
            </label>
            <label className={label}>
              Serial number <span className="font-normal text-slate-400">(optional)</span>
              <input
                value={values.serial_number}
                onChange={set("serial_number")}
                readOnly={!creating && Boolean(initial.serial_number)}
                maxLength={100}
                className={input}
              />
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
          </>
        )}
        <label className={label}>
          {software ? "Publisher" : "Manufacturer"}
          <input value={values.brand} onChange={set("brand")} maxLength={100} placeholder={software ? "e.g. Microsoft" : "e.g. Lenovo"} className={input} />
        </label>
        <label className={label}>
          {software ? "Version / edition" : "Model"}
          <input value={values.model} onChange={set("model")} maxLength={100} placeholder={software ? "e.g. E3" : ""} className={input} />
        </label>
        {!software && (
          <label className={`${label} sm:col-span-2 lg:col-span-1`}>
            Specifications
            <input value={values.specifications} onChange={set("specifications")} maxLength={2000} placeholder="e.g. i7, 16 GB RAM, 512 GB SSD" className={input} />
          </label>
        )}
      </Fieldset>

      {software ? (
        <Fieldset title="License" hint="License Count is the number of seats bought. Assigned and available seats are tracked separately.">
          <label className={label}>
            License type
            <select value={values.license_type} onChange={set("license_type")} className={input}>
              {LICENSE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {licenseTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            License Number <span className="font-normal text-slate-400">(optional)</span>
            <input
              value={values.license_number}
              onChange={set("license_number")}
              maxLength={255}
              autoComplete="off"
              placeholder="e.g. M365-ABCD-1234"
              className={`${input} font-mono`}
            />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">Only admins see the full number; users see the last 4 characters.</span>
          </label>
          <label className={label}>
            License Count <Required />
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={values.license_count}
              onChange={set("license_count")}
              placeholder="e.g. 100"
              className={input}
            />
          </label>
          <label className={label}>
            Purchase date
            <input type="date" value={values.purchase_date} onChange={set("purchase_date")} className={input} />
          </label>
          <label className={label}>
            License cost
            <input type="number" min={0} step="0.01" value={values.purchase_price} onChange={set("purchase_price")} className={input} />
          </label>
          <label className={label}>
            Expiry date
            <input type="date" value={values.license_expiry} onChange={set("license_expiry")} className={input} />
          </label>
          <label className={label}>
            Renewal date
            <input type="date" value={values.license_renewal} onChange={set("license_renewal")} className={input} />
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
        </Fieldset>
      ) : (
        <>
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
        </>
      )}

      <div className="px-5 pb-5">
        <label className={label}>
          {software ? "Notes" : "Description"}
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
