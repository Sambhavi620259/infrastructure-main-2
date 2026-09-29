"use client";

import { useState } from "react";
import { PencilSquareIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";

type Admin = { name: string; email: string; access: string; scope: string; status: "Active" | "Invited" };
const initialAdmins: Admin[] = [
  { name: "Alex Verma", email: "alex@boldandwise.com", access: "Platform Owner", scope: "All tenants", status: "Active" },
  { name: "Riya Mehta", email: "riya@boldandwise.com", access: "Billing Admin", scope: "All tenants", status: "Active" },
  { name: "Karan Singh", email: "karan@boldandwise.com", access: "Support Admin", scope: "42 tenants", status: "Active" },
  { name: "Maya Shah", email: "maya@boldandwise.com", access: "Security Admin", scope: "All tenants", status: "Invited" },
];

export default function AdminsPage() {
  const [admins, setAdmins] = useState(initialAdmins);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Admin | null>(null);
  const closeDialog = () => { setDialogOpen(false); setEditing(null); };
  const saveAdmin = (formData: FormData) => {
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const access = String(formData.get("access") || "Support Admin");
    if (editing) {
      setAdmins((current) => current.map((admin) => admin.email === editing.email ? { ...admin, name, email, access } : admin));
      setNotice(`${name}'s platform access has been updated.`);
    } else {
      setAdmins((current) => [...current, { name, email, access, scope: "All tenants", status: "Invited" }]);
      setNotice(`Invitation created for ${name}.`);
    }
    closeDialog();
  };
  return <main className="mx-auto max-w-7xl space-y-5"><header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Super Admin · Access</p><h1 className="mt-1 text-2xl font-extrabold text-slate-950">Platform administrators</h1><p className="mt-1 text-sm text-slate-500">Manage privileged access independently from tenant-level IT Admin roles.</p></div><button type="button" onClick={() => setDialogOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-700"><PlusIcon className="h-4 w-4" /> Add admin</button></header>
    {notice && <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss notification">×</button></div>}
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-bold">Admin directory</h2></div><div className="divide-y divide-slate-100">{admins.map((admin) => <div key={admin.email} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violet-50 text-xs font-extrabold text-violet-700">{admin.name.split(" ").map((part) => part[0]).join("")}</span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-slate-800">{admin.name}</p><p className="truncate text-[10px] text-slate-500">{admin.email} · {admin.access} · {admin.scope}</p></div><span className={`text-[10px] font-bold ${admin.status === "Active" ? "text-emerald-600" : "text-amber-600"}`}>{admin.status}</span><button type="button" onClick={() => { setEditing(admin); setDialogOpen(true); }} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700"><PencilSquareIcon className="h-3.5 w-3.5" /> Edit access</button></div>)}</div></section>
    {dialogOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-4"><form action={saveAdmin} className="w-full max-w-md rounded-2xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Platform access</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">{editing ? "Edit admin" : "Add administrator"}</h2></div><button type="button" onClick={closeDialog} aria-label="Close dialog" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><XMarkIcon className="h-5 w-5" /></button></div><div className="space-y-4 p-5"><label className="block text-xs font-bold text-slate-700">Full name<input name="name" required defaultValue={editing?.name} placeholder="e.g. Asha Kapoor" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500" /></label><label className="block text-xs font-bold text-slate-700">Work email<input name="email" required type="email" defaultValue={editing?.email} placeholder="admin@company.com" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500" /></label><label className="block text-xs font-bold text-slate-700">Platform role<select name="access" defaultValue={editing?.access ?? "Support Admin"} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"><option>Platform Owner</option><option>Billing Admin</option><option>Support Admin</option><option>Security Admin</option></select></label></div><div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4"><button type="button" onClick={closeDialog} className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" className="rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700">{editing ? "Save changes" : "Send invitation"}</button></div></form></div>}
  </main>;
}
