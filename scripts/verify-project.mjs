import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "src/app/layout.tsx",
  "src/app/(dashboard)/layout.tsx",
  "src/components/layout/app-shell.tsx",
  "src/lib/routes.ts",
  "src/lib/roles.ts",
  "src/app/api/health/route.ts",
  "src/app/(dashboard)/agent/dashboard/page.tsx",
  "src/app/(dashboard)/agent/tickets/page.tsx",
  "src/app/(dashboard)/agent/assets/page.tsx",
  "src/app/(dashboard)/agent/users/page.tsx",
  "src/app/(dashboard)/agent/inventory/page.tsx",
  "src/app/(dashboard)/agent/reports/page.tsx",
  "src/app/(dashboard)/agent/settings/page.tsx",
  "Dockerfile",
  ".env.example",
];

const requiredRoutes = [
  ["/dashboard", "src/app/(dashboard)/dashboard/page.tsx"],
  ["/assets", "src/app/(dashboard)/assets/page.tsx"],
  ["/software", "src/app/(dashboard)/software/page.tsx"],
  ["/discovery", "src/app/(dashboard)/discovery/page.tsx"],
  ["/cloud", "src/app/(dashboard)/cloud/page.tsx"],
  ["/financial", "src/app/(dashboard)/financial/page.tsx"],
  ["/reports", "src/app/(dashboard)/reports/page.tsx"],
  ["/users", "src/app/(dashboard)/users/page.tsx"],
  ["/settings", "src/app/(dashboard)/settings/page.tsx"],
  ["/agent/dashboard", "src/app/(dashboard)/agent/dashboard/page.tsx"],
  ["/agent/assets", "src/app/(dashboard)/agent/assets/page.tsx"],
  ["/agent/tickets", "src/app/(dashboard)/agent/tickets/page.tsx"],
  ["/agent/users", "src/app/(dashboard)/agent/users/page.tsx"],
  ["/agent/inventory", "src/app/(dashboard)/agent/inventory/page.tsx"],
  ["/agent/reports", "src/app/(dashboard)/agent/reports/page.tsx"],
  ["/agent/settings", "src/app/(dashboard)/agent/settings/page.tsx"],
  ["/super-admin", "src/app/(dashboard)/super-admin/page.tsx"],
  ["/super-admin/companies", "src/app/(dashboard)/super-admin/companies/page.tsx"],
  ["/super-admin/subscriptions", "src/app/(dashboard)/super-admin/subscriptions/page.tsx"],
  ["/super-admin/tenants", "src/app/(dashboard)/super-admin/tenants/page.tsx"],
  ["/super-admin/admins", "src/app/(dashboard)/super-admin/admins/page.tsx"],
  ["/super-admin/audit", "src/app/(dashboard)/super-admin/audit/page.tsx"],
  ["/super-admin/settings", "src/app/(dashboard)/super-admin/settings/page.tsx"],
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing file: ${file}`);
}
for (const [route, file] of requiredRoutes) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing route ${route}: ${file}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.engines?.node !== ">=20.9.0") failures.push("Node engine must remain >=20.9.0.");
if (packageJson.scripts?.check !== "npm run lint && npm run typecheck && npm run build") failures.push("The production check script is missing or changed unexpectedly.");

const routeSource = fs.readFileSync(path.join(root, "src/lib/routes.ts"), "utf8");
for (const route of requiredRoutes.map(([route]) => route)) {
  if (!routeSource.includes(`"${route}"`)) failures.push(`Route constant missing: ${route}`);
}

if (failures.length) {
  console.error("ITAM project verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(`ITAM project verification passed: ${requiredFiles.length} required files and ${requiredRoutes.length} routes checked.`);
