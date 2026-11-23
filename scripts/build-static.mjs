// Builds the static site for S3 + CloudFront into ./out, without touching the source tree.
//
//   NEXT_PUBLIC_WS_URL=wss://itam.example.com npm run build:static
//
// What differs from the normal build (Docker / `next dev` keep working unchanged):
//   * the two Next.js route handlers (src/app/api: the /api proxy and /api/health) are left out, because a static
//     site has no server. In production CloudFront sends /api/* straight to the API (deploy/cloudfront/README.md);
//   * next.config.ts exports plain files (STATIC_EXPORT=true) and does not set headers (CloudFront does).
// The build runs in a throw-away copy (.static-build), so src/ is never modified.
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = path.join(root, ".static-build");
const out = path.join(root, "out");

rmSync(work, { recursive: true, force: true });
mkdirSync(work);
for (const name of ["src", "public"]) {
  if (existsSync(path.join(root, name))) cpSync(path.join(root, name), path.join(work, name), { recursive: true });
}
for (const name of ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs", "tailwind.config.ts", "eslint.config.mjs", "next-env.d.ts"]) {
  if (existsSync(path.join(root, name))) cpSync(path.join(root, name), path.join(work, name));
}
symlinkSync(path.join(root, "node_modules"), path.join(work, "node_modules"), "dir");
rmSync(path.join(work, "src", "app", "api"), { recursive: true, force: true });

const env = { ...process.env, STATIC_EXPORT: "true", NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production" };
delete env.NEXT_DIST_DIR;
const result = spawnSync("npx", ["next", "build"], { cwd: work, env, stdio: "inherit" });
if (result.status !== 0) {
  console.error("\nStatic build failed.");
  process.exit(result.status ?? 1);
}
if (!existsSync(path.join(work, "out", "index.html"))) {
  console.error("\nThe build finished but produced no out/index.html.");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(path.join(work, "out"), out, { recursive: true });
rmSync(work, { recursive: true, force: true });
console.log(`\nStatic site written to ${path.relative(process.cwd(), out) || "out"}/ (upload its contents to the S3 bucket).`);
