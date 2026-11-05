// Local test server: serves the site and runs the /api functions, saving data in ./.data instead of GitHub.
// Run: node scripts/dev-server.js   (PORT defaults to 5190)
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
process.env.LOCAL_STORE_DIR = process.env.LOCAL_STORE_DIR || path.join(root, ".data");
const port = Number(process.env.PORT) || 5190;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname.startsWith("/api/")) {
    const name = u.pathname.slice(5).replace(/[^a-z]/g, "");
    const f = path.join(root, "api", `${name}.js`);
    if (!name || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    let body = "";
    for await (const chunk of req) body += chunk;
    try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = body; }
    res.status = code => { res.statusCode = code; return res; };
    res.json = obj => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    return require(f)(req, res);
  }
  const p = path.normalize(path.join(root, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname)));
  if (!p.startsWith(root) || p.includes(`${path.sep}.data`) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Before Forever dev server: http://localhost:${port}`));
