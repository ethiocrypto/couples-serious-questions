// Vercel serverless function: saves one finished solo session as a JSON file in a GitHub repo.
// Env vars on Vercel:
//   GITHUB_TOKEN  - fine-grained token with "Contents: Read and write" on the data repo only
//   GITHUB_REPO   - "owner/repo" that holds the answers (can be a private repo)
//   GITHUB_BRANCH - optional, defaults to "main"
const store = require("./_store");

const KEYS = new Set(["A", "B", "C", "D"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!store.configured()) return res.status(500).json({ error: "Storage not configured" });

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
    id: b.id, name, mode: "solo",
    lang: b.lang === "th" ? "th" : "en",
    started: typeof b.started === "string" ? b.started.slice(0, 30) : null,
    submitted: new Date().toISOString(), answers: clean,
  };
  const path = `responses/${record.submitted.slice(0, 10)}/${record.id}.json`;

  try {
    // Same id sent twice = already saved; the store refuses to overwrite it.
    const saved = await store.write(path, record, null, `Answers: ${name} (solo)`);
    return res.status(200).json(saved ? { ok: true } : { ok: true, already: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Could not save" });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
