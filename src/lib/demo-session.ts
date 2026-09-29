"use client";

import { roles, type Role } from "@/lib/roles";

const storageKey = "itam-demo-session";

export type DemoSession = {
  name: string;
  initials: string;
  role: Role;
};

const roleProfiles: Record<Role, DemoSession> = {
  SUPER_ADMIN: { name: "Alex Verma", initials: "AV", role: roles.SUPER_ADMIN },
  IT_ADMIN: { name: "Priya Sharma", initials: "PS", role: roles.IT_ADMIN },
  IT_AGENT: { name: "Sandeep Malik", initials: "SM", role: roles.IT_AGENT },
  HAM_ADMIN: { name: "Priya Sharma", initials: "PS", role: roles.HAM_ADMIN },
  SAM_ADMIN: { name: "Priya Sharma", initials: "PS", role: roles.SAM_ADMIN },
  CLOUD_ADMIN: { name: "Priya Sharma", initials: "PS", role: roles.CLOUD_ADMIN },
  SCAN_ADMIN: { name: "Priya Sharma", initials: "PS", role: roles.SCAN_ADMIN },
  REPORTING_USER: { name: "Priya Sharma", initials: "PS", role: roles.REPORTING_USER },
};

function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.values(roles).includes(value as Role);
}

export function getDemoSession(): DemoSession | null {
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const session: unknown = JSON.parse(raw);
    if (
      typeof session === "object" && session !== null &&
      "name" in session && "initials" in session && "role" in session &&
      typeof session.name === "string" && typeof session.initials === "string" && isRole(session.role)
    ) return session as DemoSession;
  } catch {
    // Invalid browser storage is treated as a signed-out session.
  }
  return null;
}

export function startDemoSession(role: Role) {
  const session = roleProfiles[role];
  window.sessionStorage.setItem(storageKey, JSON.stringify(session));
  return session;
}

export function endDemoSession() {
  window.sessionStorage.removeItem(storageKey);
}
