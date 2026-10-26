"use client";

import { useState } from "react";
import { LocationMap } from "@/components/maps/location-map";
import { mapSearchLink } from "@/lib/maps";
import { updateCompany } from "@/lib/super-admin";

/** The company details the contact card shows and edits (a subset of the organization record). */
export interface CompanyContact {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** The company's contact email, phone, address and office location pin (with a map). Editable by the Super Admin. */
export function ContactCard({
  org,
  canEdit,
  onSaved,
  onError,
}: {
  org: CompanyContact;
  canEdit: boolean;
  onSaved: (updated: Partial<CompanyContact>) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(org.contact_email ?? "");
  const [phone, setPhone] = useState(org.contact_phone ?? "");
  const [address, setAddress] = useState(org.address ?? "");
  const [latitude, setLatitude] = useState(org.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(org.longitude?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState("");

  const lat = latitude.trim() === "" ? null : Number(latitude);
  const lng = longitude.trim() === "" ? null : Number(longitude);
  const pinValid = lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const input = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  const useMyLocation = () => {
    if (!navigator.geolocation) return setProblem("This browser cannot share its location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setProblem("Could not get your location. Allow location access, or type the coordinates.");
        setLocating(false);
      },
    );
  };

  const save = async () => {
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setProblem("Enter a valid contact email.");
    if ((lat === null) !== (lng === null)) return setProblem("Give both latitude and longitude for the pin, or neither.");
    if (lat !== null && !pinValid) return setProblem("Latitude is -90 to 90 and longitude is -180 to 180.");
    setProblem("");
    setBusy(true);
    try {
      const saved = await updateCompany(org.id, {
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        address: address.trim() || null,
        latitude: lat,
        longitude: lng,
      });
      onSaved({
        contact_email: saved.contact_email,
        contact_phone: saved.contact_phone,
        address: saved.address,
        latitude: saved.latitude,
        longitude: saved.longitude,
      });
      setEditing(false);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not save the contact details.");
    } finally {
      setBusy(false);
    }
  };

  const showLat = editing ? (pinValid ? lat : null) : org.latitude;
  const showLng = editing ? (pinValid ? lng : null) : org.longitude;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Company contact details &amp; location</h2>
          <p className="mt-1 text-sm text-slate-500">
            {canEdit ? "Contact email, phone, office address and the office location on the map." : "Set by the Super Admin. Ask them to update anything that has changed."}
          </p>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Edit
          </button>
        )}
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Contact email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="it@company.com" className={input} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Contact phone
                <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} placeholder="+91 98765 43210" className={input} />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Office address
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={3} maxLength={1000} className={input} />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Location pin</legend>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <input value={latitude} onChange={(e) => setLatitude(e.target.value)} inputMode="decimal" placeholder="Latitude, e.g. 18.5204" aria-label="Latitude" className={input} />
                <input value={longitude} onChange={(e) => setLongitude(e.target.value)} inputMode="decimal" placeholder="Longitude, e.g. 73.8567" aria-label="Longitude" className={input} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                <button type="button" onClick={useMyLocation} disabled={locating} className="text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  {locating ? "Locating…" : "Use my current location"}
                </button>
                {address.trim() && (
                  <a href={mapSearchLink(address)} target="_blank" rel="noreferrer" className="text-brand-600 hover:text-brand-700">
                    Find this address on the map
                  </a>
                )}
                {(latitude || longitude) && (
                  <button type="button" onClick={() => { setLatitude(""); setLongitude(""); }} className="text-slate-500">
                    Remove pin
                  </button>
                )}
              </div>
            </fieldset>
            {problem && <p role="alert" className="text-sm text-red-700">{problem}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {busy ? "Saving…" : "Save contact details"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">Contact email</dt>
              <dd className="mt-1 text-slate-600">{org.contact_email ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Contact phone</dt>
              <dd className="mt-1 text-slate-600">{org.contact_phone ?? "Not set"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-700">Office address</dt>
              <dd className="mt-1 whitespace-pre-line text-slate-600">{org.address ?? "Not set"}</dd>
            </div>
          </dl>
        )}
        {showLat !== null && showLng !== null ? (
          <LocationMap latitude={showLat} longitude={showLng} label={org.name} />
        ) : (
          <div className="grid h-48 place-items-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
            {editing ? "Add latitude and longitude to see the pin." : "No office location pin yet."}
          </div>
        )}
      </div>
    </section>
  );
}
