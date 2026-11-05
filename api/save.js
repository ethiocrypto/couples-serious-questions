// Vercel serverless function: saves one finished session as a JSON file in a GitHub repo.
// Env vars on Vercel:
//   GITHUB_TOKEN  - fine-grained token with "Contents: Read and write" on the data repo only
//   GITHUB_REPO   - "owner/repo" that holds the answers (can be a private repo)
//   GITHUB_BRANCH - optional, defaults to "main"
const KEYS = new Set(["A", "B", "C", "D"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = "main" } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) return res.status(500).json({ error: "Storage not configured" });

  const b = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const name = String(b.name || "").trim().slice(0, 40);
  const answers = b.answers && typeof b.answers === "object" ? b.answers : null;
  if (!UUID.test(b.id || "") || !name || !answers) return res.status(400).json({ error: "Bad request" });

  const clean = {};
  for (let i = 1; i <= 25; i++) {
    const v = answers[i];
    if (!KEYS.has(v)) return res.status(400).json({ error: `Missing answer ${i}` });
    clean[i] = v;
  }

  const record = {
    id: b.id, name, mode: b.mode === "together" ? "together" : "solo",
    started: typeof b.started === "string" ? b.started.slice(0, 30) : null,
    submitted: new Date().toISOString(), answers: clean,
  };
  const day = record.submitted.slice(0, 10);
  const path = `responses/${day}/${record.id}.json`;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "before-forever" };

  // Same id sent twice = already saved; don't overwrite.
  const exists = await fetch(`${url}?ref=${GITHUB_BRANCH}`, { headers });
  if (exists.ok) return res.status(200).json({ ok: true, already: true });

  const put = await fetch(url, {
    method: "PUT", headers,
    body: JSON.stringify({
      message: `Answers: ${name} (${record.mode})`,
      content: Buffer.from(JSON.stringify(record, null, 2)).toString("base64"),
      branch: GITHUB_BRANCH,
    }),
  });
  if (!put.ok) return res.status(502).json({ error: "Could not save" });
  return res.status(200).json({ ok: true });
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
