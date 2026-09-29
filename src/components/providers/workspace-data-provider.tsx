"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { Role } from "@/lib/roles";

export type WorkspaceAsset = { id: string; name: string; category: string; assignedTo: string; status: "In use" | "In stock" | "In repair" };
export type WorkspaceUser = { initials: string; name: string; email: string; role: Role; status: "active" | "invited"; lastActive: string };
export type WorkspaceTicket = { id: string; subject: string; requester: string; priority: string; status: string };
type WorkspaceData = { assets: WorkspaceAsset[]; users: WorkspaceUser[]; tickets: WorkspaceTicket[]; addAsset: (asset: Omit<WorkspaceAsset, "id">) => void; addUser: (user: Omit<WorkspaceUser, "initials" | "status" | "lastActive">) => void; addTicket: (ticket: Omit<WorkspaceTicket, "id" | "status">) => void };

const Context = createContext<WorkspaceData | null>(null);
const seedAssets: WorkspaceAsset[] = [{ id: "AST-100", name: "Redmi Note 10 Pro", category: "Mobile", assignedTo: "Sarah Desai", status: "In use" }, { id: "AST-101", name: "MacBook Pro 16", category: "Laptop", assignedTo: "Sarah Desai", status: "In use" }, { id: "AST-104", name: "MacBook Air M2", category: "Laptop", assignedTo: "Unassigned", status: "In stock" }];
const seedUsers: WorkspaceUser[] = [{ initials: "NV", name: "Neha Verma", email: "neha.verma@acme.example", role: "IT_ADMIN", status: "active", lastActive: "Now" }, { initials: "PS", name: "Priya Sharma", email: "priya.sharma@acme.example", role: "HAM_ADMIN", status: "active", lastActive: "18 min ago" }];
const seedTickets: WorkspaceTicket[] = [{ id: "IT-123", subject: "Network down", requester: "Sarah Desai", priority: "High", status: "In progress" }, { id: "IT-128", subject: "Laptop replacement", requester: "Liza Roy", priority: "Medium", status: "Open" }];

export function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState(seedAssets); const [users, setUsers] = useState(seedUsers); const [tickets, setTickets] = useState(seedTickets);
  const addAsset: WorkspaceData["addAsset"] = (asset) => setAssets((current) => [{ ...asset, id: `AST-${100 + current.length + 1}` }, ...current]);
  const addUser: WorkspaceData["addUser"] = (user) => setUsers((current) => [{ ...user, initials: user.name.split(/\s+/).slice(0, 2).map((name) => name[0]).join(""), status: "invited", lastActive: "Invitation sent" }, ...current]);
  const addTicket: WorkspaceData["addTicket"] = (ticket) => setTickets((current) => [{ ...ticket, id: `IT-${123 + current.length + 1}`, status: "Open" }, ...current]);
  return <Context.Provider value={{ assets, users, tickets, addAsset, addUser, addTicket }}>{children}</Context.Provider>;
}
export function useWorkspaceData() { const value = useContext(Context); if (!value) throw new Error("useWorkspaceData must be used inside WorkspaceDataProvider"); return value; }
