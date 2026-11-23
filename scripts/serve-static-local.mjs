// Local stand-in for CloudFront + S3, for testing the static site on your own machine. NOT for production.
//
//   npm run build:static
//   API_ORIGIN=http://127.0.0.1:8000 node scripts/serve-static-local.mjs [port]      (default 4000)
//
// It behaves like the planned distribution: the real deploy/cloudfront/viewer-request.js decides which file a URL
// maps to, a missing file answers 404 with /404.html (the custom error response), and /api/* goes straight to the API
// origin with no Next.js server in between (same address as the site, so no CORS).
import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const port = Number(process.argv[2] || process.env.PORT || 4000);
const api = new URL(process.env.API_ORIGIN || "http://127.0.0.1:8000");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(root, "deploy", "cloudfront", "viewer-request.js"), "utf8"), sandbox);
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain" };

function send(res, file, status) {
  res.writeHead(status, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  if (pathname.startsWith("/api/")) {
    const upstream = http.request({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: { ...req.headers, host: api.host } },
      (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); });
    upstream.on("error", () => { res.writeHead(502); res.end("API origin unreachable"); });
    req.pipe(upstream);
    return;
  }
  const mapped = sandbox.handler({ request: { uri: pathname, headers: {}, querystring: {} } }).uri;
  const file = path.join(out, mapped);
  if (file.startsWith(out) && existsSync(file) && statSync(file).isFile()) return send(res, file, 200);
  send(res, path.join(out, "404.html"), 404);
}).listen(port, () => console.log(`Static site from ${out} on http://localhost:${port} (API origin ${api.origin})`));
