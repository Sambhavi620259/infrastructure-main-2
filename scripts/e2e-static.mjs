// Browser test of the static site, served the way CloudFront will serve it (scripts/serve-static-local.mjs).
// Needs: playwright-core and Chrome (not project dependencies). Does NOT touch AWS.
//
//   npm run build:static
//   API_ORIGIN=http://127.0.0.1:8000 node scripts/serve-static-local.mjs 4000 &
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core/index.mjs \
//   CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//   E2E_SUPER=super@x.com:pass E2E_ADMIN=admin@x.com:pass E2E_USER=user@x.com:pass node scripts/e2e-static.mjs
//
// Use accounts of a disposable test stack. It creates one category, ticket and asset there.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BASE = process.env.E2E_BASE || "http://localhost:4000";
const split = (v) => { const i = v.indexOf(":"); return [v.slice(0, i), v.slice(i + 1)]; };
const [SUPER, ADMIN, USER] = ["E2E_SUPER", "E2E_ADMIN", "E2E_USER"].map((k) => {
  if (!process.env[k]) { console.error(`Set ${k}=email:password`); process.exit(2); }
  return split(process.env[k]);
});

let passed = 0, failed = 0;
const check = (label, ok, detail = "") => { if (ok) passed++; else failed++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`); };
const api = async (method, path, token, body) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};
const tokenOf = async ([email, password]) => (await api("POST", "/auth/login", null, { email, password })).data?.access_token;

console.log("Setup (through the static site's /api, straight to the API)");
const tAdmin = await tokenOf(ADMIN), tUser = await tokenOf(USER), tSuper = await tokenOf(SUPER);
check("the three accounts can sign in through /api", tAdmin && tUser && tSuper);
const stamp = Date.now();
let cats = (await api("GET", "/assets/categories", tAdmin)).data;
let category = Array.isArray(cats) && cats[0] ? (cats[0].id ?? cats[0]) : (await api("POST", "/assets/categories", tAdmin, { name: `E2E ${stamp}` })).data?.id;
let ticket = (await api("POST", "/asset-requests", tUser, { asset_category_id: category, reason: "static e2e" })).data;
if (!ticket?.id) {
  // The API allows one open request per category per person, so a second run reuses the existing ticket.
  const mine = (await api("GET", "/asset-requests?limit=50", tUser)).data;
  ticket = Array.isArray(mine) ? mine[0] : undefined;
}
const asset = (await api("POST", "/assets", tAdmin, { asset_tag: `E2E-${stamp}`, serial_number: `S${stamp}`, name: "E2E laptop", category: "Laptop" })).data;
const people = (await api("GET", "/users?limit=200", tAdmin)).data || [];
const person = people.find((p) => p.email === USER[0]);
check("a ticket, an asset and a user exist to open", ticket?.id && asset?.id && person?.id, { ticket: ticket?.id, asset: asset?.id, person: person?.id });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
async function session([email, password]) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  const bad = [], calls = [];
  page.on("response", (r) => { if (r.url().includes("/api/")) { calls.push(`${r.status()} ${r.url().replace(BASE, "")}`); if (r.status() >= 400) bad.push(`${r.status()} ${r.url().replace(BASE, "")}`); } });
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"], form button:has-text("Sign In")');
  await page.waitForTimeout(3500);
  return { page, bad, calls, ctx };
}
async function openDetail(s, url, apiNeedle, label) {
  for (const how of ["opened by address", "after a refresh"]) {
    s.calls.length = 0;
    if (how === "opened by address") await s.page.goto(`${BASE}${url}`); else await s.page.reload();
    await s.page.waitForTimeout(2500);
    const asked = s.calls.filter((c) => c.includes(apiNeedle));
    check(`${label} ${how}: stays on its address and asks the API for the real id (${apiNeedle})`,
      s.page.url() === `${BASE}${url}` && asked.length > 0 && asked.every((c) => c.startsWith("200")), { url: s.page.url(), asked: asked.slice(0, 3) });
  }
}

console.log("The address bar and the 404 page");
const anon = await browser.newPage();
await anon.goto(`${BASE}/`); await anon.waitForTimeout(2500);
check("/ ends on the sign-in page", anon.url() === `${BASE}/login`, anon.url());
const missing = await anon.goto(`${BASE}/no-such-page`);
check("an unknown address answers 404 with the 404 page", missing.status() === 404, missing.status());
await anon.goto(`${BASE}/register`); await anon.waitForTimeout(2000);
check("/register loads directly", (await anon.locator("h2").first().textContent()).length > 0);

console.log("Super Admin");
let s = await session(SUPER);
check("lands on /super-admin", s.page.url() === `${BASE}/super-admin`, s.page.url());
await openDetail(s, `/super-admin/work/${person.id}`, `/users/${person.id}`, "work page");
check("no API call failed", s.bad.length === 0, s.bad.slice(0, 4)); await s.ctx.close();

console.log("IT Admin");
s = await session(ADMIN);
check("lands on /dashboard", s.page.url() === `${BASE}/dashboard`, s.page.url());
await openDetail(s, `/tickets/${ticket.id}`, `/asset-requests/${ticket.id}`, "ticket");
await openDetail(s, `/assets/${asset.id}`, `/assets/${asset.id}`, "asset");
await openDetail(s, `/users/${person.id}`, `/users/${person.id}`, "user");
s.calls.length = 0; await s.page.goto(`${BASE}/assets/hardware/new`); await s.page.waitForTimeout(2000);
check("a nested fixed page (/assets/hardware/new) opens directly", s.page.url() === `${BASE}/assets/hardware/new`, s.page.url());
await s.page.goto(`${BASE}/assets/new`); await s.page.waitForTimeout(2000);
check("/assets/new is the 'new' page, not an asset called 'new'", !s.calls.some((c) => c.includes("/assets/new")), s.calls.slice(0, 3));
check("no API call failed", s.bad.filter((b) => !b.includes("/assets/new")).length === 0, s.bad.slice(0, 4)); await s.ctx.close();

console.log("User (IT Agent)");
s = await session(USER);
check("lands on /agent/dashboard", s.page.url() === `${BASE}/agent/dashboard`, s.page.url());
await openDetail(s, `/agent/tickets/${ticket.id}`, `/asset-requests/${ticket.id}`, "own ticket");
await s.page.goto(`${BASE}/users`); await s.page.waitForTimeout(2500);
check("a user opening /users is sent back to their own area", s.page.url().includes("/agent/"), s.page.url());
await s.ctx.close();

await browser.close();
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
