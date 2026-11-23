// Checks the static site in ./out (run `npm run build:static` first) and the CloudFront viewer-request function.
//   npm run check:static
// Exits non-zero if anything fails. It needs no network and no AWS.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
let failed = 0;
let passed = 0;
const check = (label, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

if (!existsSync(path.join(out, "index.html"))) {
  console.error("out/index.html is missing: run `npm run build:static` first.");
  process.exit(2);
}
const files = walk(out).map((f) => "/" + path.relative(out, f).split(path.sep).join("/"));
const htmlFiles = files.filter((f) => f.endsWith(".html"));

console.log("The static site");
check("index.html, 404.html, login.html and register.html exist", ["/index.html", "/404.html", "/login.html", "/register.html"].every((f) => files.includes(f)));
check("no server code or API routes are in the output", !files.some((f) => f.startsWith("/api/") || f.startsWith("/server/")), files.filter((f) => f.startsWith("/api/")));
check("every dashboard section has a page (dashboard, assets, requests, users, reports, super-admin, agent)",
  ["/dashboard.html", "/assets.html", "/requests.html", "/users.html", "/reports.html", "/super-admin.html", "/agent/dashboard.html"].every((f) => files.includes(f)));
const detailRoutes = ["tickets", "users", "assets", "agent/tickets", "super-admin/work"];
check("each detail route has its placeholder page", detailRoutes.every((r) => files.includes(`/${r}/_.html`)), detailRoutes.filter((r) => !files.includes(`/${r}/_.html`)));
check("hashed, cacheable assets are under /_next/static/", files.some((f) => /^\/_next\/static\/chunks\/.*[0-9a-f]{8,}.*\.js$/.test(f)));

console.log("Nothing private is in the files that go to S3");
const text = files.filter((f) => /\.(html|js|txt|json|css|map)$/.test(f)).map((f) => [f, readFileSync(path.join(out, f), "utf8")]);
const forbidden = ["BACKEND_PROXY_KEY", "BACKEND_API_URL", "http://127.0.0.1", "itam_password", "JWT_SECRET", "PROXY_SHARED_SECRET", "SEED_SUPER_ADMIN"];
for (const word of forbidden) {
  const hits = text.filter(([, body]) => body.includes(word)).map(([f]) => f);
  check(`no file mentions ${word}`, hits.length === 0, hits.slice(0, 3));
}
const secretPatterns = [/AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
check("no AWS access key or private key", text.every(([, body]) => secretPatterns.every((p) => !p.test(body))));
check("no source maps are published", !files.some((f) => f.endsWith(".map")));

console.log("CloudFront viewer-request function");
const source = readFileSync(path.join(root, "deploy", "cloudfront", "viewer-request.js"), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const route = (uri) => sandbox.handler({ request: { uri, headers: {}, querystring: {} } }).uri;
const urlOf = (file) => (file === "/index.html" ? "/" : file.replace(/\.html$/, ""));
const wrong = [];
for (const file of htmlFiles.filter((f) => f !== "/404.html")) {
  const isPlaceholder = detailRoutes.some((r) => file === `/${r}/_.html`);
  const url = isPlaceholder ? file.replace("/_.html", "/some-real-id-123") : urlOf(file);
  if (route(url) !== file) wrong.push(`${url} -> ${route(url)} (wanted ${file})`);
}
check(`every page in the build is reachable by its clean URL (${htmlFiles.length - 1} pages)`, wrong.length === 0, wrong.slice(0, 5));
check("a trailing slash works", route("/tickets/") === "/tickets.html" && route("/users/new/") === "/users/new.html");
check("the root serves index.html", route("/") === "/index.html");
check("real ids (UUIDs, odd characters) get the placeholder page",
  route("/tickets/4f5b73ff-c9e6-4438-9d86-edc35eab8294") === "/tickets/_.html" && route("/users/a%20b") === "/users/_.html" &&
  route("/assets/AST-000123") === "/assets/_.html" && route("/agent/tickets/9") === "/agent/tickets/_.html" &&
  route("/super-admin/work/7") === "/super-admin/work/_.html");
check("fixed pages under a detail route are not taken for ids",
  route("/assets/new") === "/assets/new.html" && route("/assets/hardware") === "/assets/hardware.html" &&
  route("/assets/hardware/new") === "/assets/hardware/new.html" && route("/users/departments") === "/users/departments.html" &&
  route("/tickets/dashboard") === "/tickets/dashboard.html");
check("files with an extension and /_next/ are left alone",
  route("/_next/static/chunks/a.js") === "/_next/static/chunks/a.js" && route("/favicon.ico") === "/favicon.ico" && route("/logo.png") === "/logo.png");
const childrenInBuild = {};
for (const r of detailRoutes) {
  childrenInBuild[r] = files.filter((f) => f.startsWith(`/${r}/`) && f.endsWith(".html") && f.split("/").length === r.split("/").length + 2)
    .map((f) => path.basename(f, ".html")).filter((n) => n !== "_").sort();
}
const inFunction = vm.runInContext("STATIC_CHILDREN", sandbox);
const drift = detailRoutes.filter((r) => JSON.stringify([...inFunction[r]].sort()) !== JSON.stringify(childrenInBuild[r]));
check("the function's list of fixed pages matches the build (no drift)", drift.length === 0,
  drift.map((r) => `${r}: function ${JSON.stringify(inFunction[r])} build ${JSON.stringify(childrenInBuild[r])}`));

console.log("CloudFront response headers policy matches next.config.ts");
const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
const policy = JSON.parse(readFileSync(path.join(root, "deploy", "cloudfront", "response-headers-policy.json"), "utf8"));
const productionBlock = config.slice(config.indexOf("const productionPolicy = ["), config.indexOf('].join("; ")'));
const fromConfig = [...productionBlock.matchAll(/^\s*[`"](.+?)[`"],?\s*$/gm)].map((m) => m[1])
  .filter((d) => !d.startsWith("const ")).map((d) => d.startsWith("connect-src") ? "connect-src 'self' wss://SITE_DOMAIN https://SITE_DOMAIN" : d);
const fromPolicy = policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy.split("; ");
check("the Content-Security-Policy in the CloudFront policy has exactly the directives next.config.ts sets in production",
  fromConfig.length > 5 && JSON.stringify([...fromConfig].sort()) === JSON.stringify([...fromPolicy].sort()), { config: fromConfig, policy: fromPolicy });
const pairs = Object.fromEntries([...config.matchAll(/\{ key: "([A-Za-z-]+)", value: "([^"]+)" \}/g)].map((m) => [m[1], m[2]]));
const sec = policy.SecurityHeadersConfig;
const custom = Object.fromEntries(policy.CustomHeadersConfig.Items.map((i) => [i.Header, i.Value]));
check("X-Content-Type-Options, X-Frame-Options and Referrer-Policy match",
  pairs["X-Content-Type-Options"] === "nosniff" && sec.ContentTypeOptions.Override === true &&
  pairs["X-Frame-Options"] === sec.FrameOptions.FrameOption && pairs["Referrer-Policy"] === sec.ReferrerPolicy.ReferrerPolicy,
  { pairs });
check("Permissions-Policy, X-DNS-Prefetch-Control and Cross-Origin-Opener-Policy match",
  ["Permissions-Policy", "X-DNS-Prefetch-Control", "Cross-Origin-Opener-Policy"].every((h) => pairs[h] === custom[h]),
  { pairs, custom });
check("Strict-Transport-Security matches (one year, includeSubDomains)",
  config.includes("max-age=31536000; includeSubDomains") && sec.StrictTransportSecurity.AccessControlMaxAgeSec === 31536000 && sec.StrictTransportSecurity.IncludeSubdomains === true);
check("every header sets Override so the S3 origin cannot leave one out",
  sec.ContentSecurityPolicy.Override && sec.StrictTransportSecurity.Override && sec.FrameOptions.Override && sec.ReferrerPolicy.Override &&
  policy.CustomHeadersConfig.Items.every((i) => i.Override === true));

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
