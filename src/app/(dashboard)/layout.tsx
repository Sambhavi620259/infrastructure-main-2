import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceDataProvider } from "@/components/providers/workspace-data-provider";

export default function DashboardLayout({ children }: Readonly<{ children?: ReactNode }>) {
  return <WorkspaceDataProvider><AppShell>{children}</AppShell></WorkspaceDataProvider>;
}
