"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircleIcon, PlusIcon, ShieldCheckIcon, UserPlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { roleDefinitions, roleOptions, type Role } from "@/lib/roles";
import { apiFetch } from "@/lib/api";

type UserStatus = "active" | "invited" | "suspended";
type User = {
  initials: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastActive: string;
};

const initialUsers: User[] = [
  { initials: "NV", name: "Neha Verma", email: "neha.verma@acme.example", role: "IT_ADMIN", status: "active", lastActive: "Now" },
  { initials: "PS", name: "Priya Sharma", email: "priya.sharma@acme.example", role: "HAM_ADMIN", status: "active", lastActive: "18 min ago" },
  { initials: "AN", name: "Arjun Nair", email: "arjun.nair@acme.example", role: "SAM_ADMIN", status: "active", lastActive: "2 hrs ago" },
  { initials: "RK", name: "Rohit Kapoor", email: "rohit.kapoor@acme.example", role: "REPORTING_USER", status: "active", lastActive: "Yesterday" },
  { initials: "JM", name: "Julia Moore", email: "julia.moore@acme.example", role: "REPORTING_USER", status: "invited", lastActive: "Invitation sent" },
  { initials: "SD", name: "Sameer Desai", email: "sameer.desai@acme.example", role: "HAM_ADMIN", status: "suspended", lastActive: "12 Aug" },
];

const styles: Record<UserStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  invited: "bg-blue-50 text-blue-700",
  suspended: "bg-slate-100 text-slate-600",
};

const roleBadge: Record<Role, string> = {
  SUPER_ADMIN: "bg-violet-50 text-violet-700",
  IT_ADMIN: "bg-blue-50 text-blue-700",
  HAM_ADMIN: "bg-cyan-50 text-cyan-700",
  SAM_ADMIN: "bg-amber-50 text-amber-700",
  CLOUD_ADMIN: "bg-indigo-50 text-indigo-700",
  SCAN_ADMIN: "bg-emerald-50 text-emerald-700",
  REPORTING_USER: "bg-slate-100 text-slate-700",
  IT_AGENT: "bg-teal-50 text-teal-700",
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | UserStatus>("all");
  const [role, setRole] = useState<"all" | Role>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const filteredUsers = useMemo(
    () => users.filter((user) => {
      const matchesStatus = status === "all" || user.status === status;
      const matchesRole = role === "all" || user.role === role;
      const matchesQuery = `${user.name} ${user.email} ${roleDefinitions[user.role].label}`.toLowerCase().includes(query.trim().toLowerCase());
      return matchesStatus && matchesRole && matchesQuery;
    }),
    [query, role, status, users],
  );

  const inviteUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const selectedRole = String(form.get("role") ?? "REPORTING_USER") as Role;
    if (!name || !email || !roleDefinitions[selectedRole]) return;

    const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
    if (selectedRole === "IT_AGENT") {
      try {
        const data = await apiFetch<{ invitationToken: string }>("/api/admin/invite", {
          method: "POST",
          body: JSON.stringify({ email, department: "IT Support" }),
        });
        setUsers((current) => [
          { initials, name, email, role: selectedRole, status: "invited", lastActive: "Invitation created" },
          ...current,
        ]);
        setDialogOpen(false);
        setNotice(`IT Agent invitation created for ${email}. Give the user this invitation token: ${data.invitationToken}`);
      } catch (caught) {
        setNotice(caught instanceof Error ? caught.message : "Unable to create the invitation.");
      }
      return;
    }

    setUsers((current) => [
      { initials, name, email, role: selectedRole, status: "invited", lastActive: "Invitation sent" },
      ...current,
    ]);
    setDialogOpen(false);
    setNotice(`${roleDefinitions[selectedRole].label} invitation prepared for ${email}. Connect this action to the identity/invitation API in production.`);
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">IT Admin · Access administration</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">Users & sub-admin roles</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Create users, assign one least-privilege role, and keep module ownership separate from the company IT Admin.</p>
        </div>
        <button type="button" onClick={() => setDialogOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700">
          <UserPlusIcon className="h-4 w-4" /> Invite user
        </button>
      </header>

      {notice && <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"><CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" /><span className="flex-1">{notice}</span><button type="button" onClick={() => setNotice("")} className="font-bold">Dismiss</button></div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          [String(users.length), "Total users", "Company directory"],
          [String(users.filter((item) => item.role === "IT_ADMIN").length), "IT Admins", "Full company administration"],
          [String(users.filter((item) => item.role !== "IT_ADMIN" && item.role !== "REPORTING_USER").length), "Sub-admins", "HAM · SAM · Cloud · Scan"],
          [String(users.filter((item) => item.role === "REPORTING_USER").length), "Reporting users", "Reports only"],
          [String(users.filter((item) => item.status === "invited").length), "Pending", "Invitations"],
        ].map(([value, label, hint]) => <article key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xl font-extrabold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs font-bold text-slate-700">{label}</p><p className="mt-1 text-[10px] text-slate-500">{hint}</p></article>)}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div><h2 className="text-sm font-bold text-slate-900">User directory</h2><p className="mt-0.5 text-[11px] text-slate-500">{filteredUsers.length} of {users.length} users shown.</p></div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input aria-label="Search users" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people or roles" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            <select aria-label="Filter users by role" value={role} onChange={(event) => setRole(event.target.value as "all" | Role)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-brand-500"><option value="all">All roles</option>{roleOptions.map((item) => <option key={item} value={item}>{roleDefinitions[item].label}</option>)}</select>
            <select aria-label="Filter users by status" value={status} onChange={(event) => setStatus(event.target.value as "all" | UserStatus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none focus:border-brand-500"><option value="all">All status</option><option value="active">Active</option><option value="invited">Invited</option><option value="suspended">Suspended</option></select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left">
            <caption className="sr-only">Company users and role assignments</caption>
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400"><tr>{["User", "Role", "Scope", "Status", "Last active", "Action"].map((heading) => <th key={heading} scope="col" className="px-4 py-2.5 font-bold">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user) => <tr key={user.email} className="text-xs hover:bg-slate-50/70">
                <td className="px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">{user.initials}</span><div><p className="font-bold text-slate-800">{user.name}</p><p className="text-[10px] text-slate-500">{user.email}</p></div></div></td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${roleBadge[user.role]}`}>{roleDefinitions[user.role].label}</span></td>
                <td className="px-4 py-3 text-slate-600">{roleDefinitions[user.role].scope}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold capitalize ${styles[user.status]}`}>{user.status}</span></td>
                <td className="px-4 py-3 text-slate-500">{user.lastActive}</td>
                <td className="px-4 py-3 text-right"><button type="button" onClick={() => setNotice(`Role management selected for ${user.name}. Persist changes through the authorization API.`)} className="font-bold text-brand-600 hover:text-brand-700">Manage</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {filteredUsers.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No users match the selected filters.</div>}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between"><div><h2 className="text-sm font-bold text-slate-900">Role model</h2><p className="mt-1 text-[11px] text-slate-500">The UI exposes these scopes; the backend must enforce the same permissions on every API request.</p></div><ShieldCheckIcon className="h-5 w-5 text-brand-500" /></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roleOptions.map((item) => { const definition = roleDefinitions[item]; return <article key={item} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold text-slate-800">{definition.label}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">{definition.scope}</span></div><p className="mt-2 text-[11px] leading-4 text-slate-500">{definition.description}</p><div className="mt-3 flex flex-wrap gap-1.5">{definition.permissions.map((permission) => <span key={permission} className="rounded-md bg-slate-50 px-1.5 py-1 text-[9px] font-semibold text-slate-500">{permission}</span>)}</div></article>; })}
        </div>
      </section>

      {dialogOpen && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/30 p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="invite-user-title" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-brand-600">Company user provisioning</p><h2 id="invite-user-title" className="mt-1 text-lg font-extrabold text-slate-950">Invite user & assign role</h2></div><button type="button" aria-label="Close dialog" onClick={() => setDialogOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><XMarkIcon className="h-4 w-4" /></button></div>
          <form onSubmit={inviteUser} className="mt-5 space-y-4">
            <label className="block text-xs font-bold text-slate-700">Full name<input name="name" required className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="e.g. Ananya Singh" /></label>
            <label className="block text-xs font-bold text-slate-700">Work email<input name="email" type="email" required className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="name@company.com" /></label>
            <label className="block text-xs font-bold text-slate-700">Role<select name="role" defaultValue="REPORTING_USER" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-500"><option value="IT_ADMIN">IT Admin</option><option value="IT_AGENT">IT Agent</option><option value="HAM_ADMIN">HAM Sub-Admin</option><option value="SAM_ADMIN">SAM Sub-Admin</option><option value="CLOUD_ADMIN">Cloud Sub-Admin</option><option value="SCAN_ADMIN">Discovery Sub-Admin</option><option value="REPORTING_USER">Reporting User</option></select></label>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-4 text-blue-800">Production flow: create the identity in your IdP, persist the role in the tenant membership record, emit an audit event, and send the invitation through the backend.</div>
            <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-brand-700"><PlusIcon className="h-3.5 w-3.5" /> Prepare invitation</button></div>
          </form>
        </div>
      </div>}
    </main>
  );
}
