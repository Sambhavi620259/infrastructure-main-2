"use client";

import { useEffect, useMemo, useState } from "react";
import { getContactDirectory, planLabel, type DirectoryEntry } from "@/lib/super-admin";
import { mapLink } from "@/lib/maps";
import { LocationMap } from "@/components/maps/location-map";

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Super Admin report: every organization's contact details, office pin and IT Admins. */
export default function ContactDirectoryPage() {
  const [rows, setRows] = useState<DirectoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [shownMap, setShownMap] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getContactDirectory()
      .then(setRows)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load the contact directory."))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.name, row.code, row.contact_email, row.contact_phone, row.address, ...row.it_admins.flatMap((a) => [a.full_name, a.email])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, query]);

  const download = () => {
    const header = ["Organization", "Code", "Status", "Plan", "Contact email", "Contact phone", "Address", "Latitude", "Longitude", "Map", "IT Admins"];
    const lines = visible.map((row) =>
      [
        row.name,
        row.code,
        row.status,
        row.plan ? planLabel(row.plan) : "",
        row.contact_email,
        row.contact_phone,
        row.address,
        row.latitude,
        row.longitude,
        row.latitude !== null && row.longitude !== null ? mapLink(row.latitude, row.longitude) : "",
        row.it_admins.map((a) => `${a.full_name} <${a.email}>${a.phone ? ` ${a.phone}` : ""}`).join("; "),
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `contact-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const withContact = rows.filter((r) => r.contact_email || r.contact_phone).length;
  const pinned = rows.filter((r) => r.latitude !== null && r.longitude !== null).length;

  return (
    <main className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Reports</p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-950">Contact directory</h1>
          <p className="mt-1 text-sm text-slate-500">
            Each organization&rsquo;s contact email, phone, address, office location and IT Admins. Edit details under Companies.
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          disabled={visible.length === 0}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
        >
          Download CSV
        </button>
      </header>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["Organizations", rows.length],
          ["With contact details", withContact],
          ["With a location pin", pinned],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xl font-extrabold text-slate-950">{loading ? "—" : value}</p>
            <p className="mt-1 text-xs font-bold text-slate-600">{label}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search organization, email, phone, address or IT Admin"
            aria-label="Search the contact directory"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm sm:max-w-md"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                {["Organization", "Contact", "Address", "Location", "IT Admins"].map((h) => (
                  <th key={h} className="px-4 py-2.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => {
                const hasPin = row.latitude !== null && row.longitude !== null;
                return (
                  <tr key={row.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{row.name}</p>
                      <p className="text-[11px] text-slate-500">
                        <span className="font-mono">{row.code}</span>
                        {row.plan ? ` · ${planLabel(row.plan)}` : ""}
                        {row.status !== "ACTIVE" ? " · Suspended" : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {row.contact_email ? (
                        <a href={`mailto:${row.contact_email}`} className="block font-semibold text-brand-600 hover:text-brand-700">
                          {row.contact_email}
                        </a>
                      ) : null}
                      {row.contact_phone ? <span className="block">{row.contact_phone}</span> : null}
                      {!row.contact_email && !row.contact_phone && <span className="text-slate-400">Not set</span>}
                    </td>
                    <td className="max-w-xs whitespace-pre-line px-4 py-3 text-xs text-slate-600">{row.address || <span className="text-slate-400">Not set</span>}</td>
                    <td className="px-4 py-3 text-xs">
                      {hasPin ? (
                        <div className="w-64 space-y-2">
                          <button
                            type="button"
                            onClick={() => setShownMap(shownMap === row.id ? "" : row.id)}
                            className="font-semibold text-brand-600 hover:text-brand-700"
                          >
                            {shownMap === row.id ? "Hide map" : "Show on map"}
                          </button>
                          {shownMap === row.id && <LocationMap latitude={row.latitude!} longitude={row.longitude!} label={row.name} />}
                        </div>
                      ) : (
                        <span className="text-slate-400">No pin</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {row.it_admins.length === 0 ? (
                        <span className="text-slate-400">None</span>
                      ) : (
                        <ul className="space-y-1">
                          {row.it_admins.map((admin) => (
                            <li key={admin.id}>
                              <span className="font-semibold text-slate-700">{admin.full_name}</span>
                              {admin.status !== "ACTIVE" && <span className="text-slate-400"> (removed)</span>}
                              <span className="block">
                                {admin.email}
                                {admin.phone ? ` · ${admin.phone}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && visible.length === 0 && !error && <p className="p-8 text-center text-sm text-slate-500">No organizations match.</p>}
      </section>
    </main>
  );
}
