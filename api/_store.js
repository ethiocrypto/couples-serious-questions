// Tiny JSON file store shared by the API functions.
// On Vercel it saves files in a GitHub repo (GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH).
// For local testing set LOCAL_STORE_DIR and it saves files in that folder instead.
// The underscore in the file name keeps Vercel from turning this into its own endpoint.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = "main", LOCAL_STORE_DIR } = process.env;
const LOCAL = !!LOCAL_STORE_DIR;

const configured = () => LOCAL || !!(GITHUB_TOKEN && GITHUB_REPO);
const ghUrl = p => `https://api.github.com/repos/${GITHUB_REPO}/contents/${p}`;
const ghHeaders = () => ({ Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "before-forever" });
const localFile = p => path.join(LOCAL_STORE_DIR, ...p.split("/"));
const digest = s => crypto.createHash("sha256").update(s).digest("hex");

// Returns { data, sha } or null when the file does not exist.
async function read(p) {
  if (LOCAL) {
    const f = localFile(p);
    if (!fs.existsSync(f)) return null;
    const txt = fs.readFileSync(f, "utf8");
    return { data: JSON.parse(txt), sha: digest(txt) };
  }
  const r = await fetch(`${ghUrl(p)}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`read ${r.status}`);
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, "base64").toString("utf8")), sha: j.sha };
}

// sha = null means "create, the file must not exist yet".
// Returns true when saved, false when someone else changed the file first (caller re-reads and retries).
async function write(p, data, sha, message) {
  const text = JSON.stringify(data, null, 2);
  if (LOCAL) {
    const f = localFile(p);
    const exists = fs.existsSync(f);
    if (sha === null ? exists : !exists || digest(fs.readFileSync(f, "utf8")) !== sha) return false;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    return true;
  }
  const r = await fetch(ghUrl(p), {
    method: "PUT", headers: ghHeaders(),
    body: JSON.stringify({ message, content: Buffer.from(text).toString("base64"), branch: GITHUB_BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) return false;
  if (!r.ok) throw new Error(`write ${r.status}`);
  return true;
}

module.exports = { configured, read, write };
