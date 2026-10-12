"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listAssetCategories, type AssetCategory } from "@/lib/tickets";
import {
  ignoreDevice,
  listDiscoveredDevices,
  promoteDevice,
  type DeviceStatus,
  type DiscoveredDevice,
} from "@/lib/operations";

const TABS: [DeviceStatus, string][] = [
  ["UNMANAGED", "To review"],
  ["MANAGED", "Promoted"],
  ["IGNORED", "Ignored"],
];

function seen(value: string | null): string {
  return value ? new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function DiscoveryPage() {
  const [tab, setTab] = useState<DeviceStatus>("UNMANAGED");
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [promoting, setPromoting] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    listAssetCategories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDiscoveredDevices(tab)
      .then((data) => {
        if (!cancelled) setDevices(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Unable to load discovered devices.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, refreshKey]);

  const done = (message: string) => {
    setNotice(message);
    setError("");
    setPromoting(null);
    setRefreshKey((key) => key + 1);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-5">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Discovery</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Network discovery</h1>
        <p className="mt-1 text-sm text-slate-500">
          Devices reported by scans and endpoint agents. Promote the ones you own to assets, ignore the rest.
        </p>
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

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div role="tablist" aria-label="Device status" className="flex gap-2 border-b border-slate-100 p-4">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${tab === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                {["Host", "Address", "System", "Serial", "Last seen", ""].map((h) => (
                  <th key={h} className="px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map((device) => (
                <tr key={device.id} className="align-top text-sm">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-800">{device.hostname ?? "Unknown host"}</p>
                    {device.device_type && <p className="text-xs text-slate-500">{device.device_type}</p>}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {device.ip_address}
                    <br />
                    {device.mac_address}
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-600">
                    {[device.os_name, device.cpu_model, device.ram_gb ? `${Number(device.ram_gb)} GB RAM` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">{device.serial_number ?? "—"}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">{seen(device.last_seen)}</td>
                  <td className="px-5 py-3 text-right">
                    {device.status === "UNMANAGED" &&
                      (promoting === device.id ? (
                        <PromoteForm
                          device={device}
                          categories={categories}
                          onCancel={() => setPromoting(null)}
                          onDone={(tag) => done(`${device.hostname ?? device.mac_address} is now asset ${tag}.`)}
                          onError={setError}
                        />
                      ) : (
                        <span className="inline-flex gap-3 text-sm font-semibold">
                          <button type="button" onClick={() => setPromoting(device.id)} className="text-brand-600 hover:text-brand-700">
                            Promote to asset
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              ignoreDevice(device.id)
                                .then(() => done(`${device.hostname ?? device.mac_address} ignored.`))
                                .catch((caught) => setError(caught instanceof Error ? caught.message : "Update failed."))
                            }
                            className="text-slate-500 hover:text-slate-700"
                          >
                            Ignore
                          </button>
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && devices.length === 0 && !error && (
          <p className="p-10 text-center text-sm text-slate-500">
            {tab === "UNMANAGED"
              ? "Nothing to review. Devices appear here when a scan or agent reports them to POST /api/discovery/agent-ingest."
              : "No devices here."}
          </p>
        )}
      </section>
      <p className="text-xs text-slate-500">
        Promoted devices become assets in stock. Find them under <Link href="/assets" className="font-semibold text-brand-600">All Assets</Link>.
      </p>
    </main>
  );
}

function PromoteForm({
  device,
  categories,
  onCancel,
  onDone,
  onError,
}: {
  device: DiscoveredDevice;
  categories: AssetCategory[];
  onCancel: () => void;
  onDone: (tag: string) => void;
  onError: (message: string) => void;
}) {
  const [tag, setTag] = useState("");
  const [category, setCategory] = useState(categories[0]?.name ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!tag.trim() || !category) return onError("Enter an asset tag and choose a category.");
    setBusy(true);
    try {
      await promoteDevice(device.id, { asset_tag: tag.trim(), category });
      onDone(tag.trim());
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not promote the device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <label>
        <span className="sr-only">Asset tag</span>
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Asset tag" className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-xs" />
      </label>
      <label>
        <span className="sr-only">Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs">
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
        {busy ? "Saving…" : "Create asset"}
      </button>
      <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-500">
        Cancel
      </button>
    </span>
  );
}
