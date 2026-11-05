// Vercel serverless function for "Answer together".
// One file per couple: couples/<id>.json. Person "a" is the inviter, person "b" joins with the invite link.
// Secrets (invite code, personal tokens) are stored only as SHA-256 hashes.
// Nobody sees the partner's answers while still answering. Once you finish, you can follow the
// partner's answers so far; when both finish, both get the full comparison.
//
// POST /api/couple  { action, ... }
//   create { name, lang }               -> { id, invite, token }
//   peek   { id, invite }               -> { inviter, taken }
//   join   { id, invite, name, lang }   -> { token, partner }
//   progress { id, token, answers }     -> { ok }   (answers so far, can still change)
//   answer { id, token, answers }       -> { ok }
//   status { id, token }                -> { me, partner, answers? }
const crypto = require("crypto");
const store = require("./_store");

const N = 25;
const KEYS = new Set(["A", "B", "C", "D"]);
const ID = /^[0-9a-f]{16}$/, INVITE = /^[0-9a-f]{16}$/, TOKEN = /^[0-9a-f]{48}$/;
const rand = bytes => crypto.randomBytes(bytes).toString("hex");
const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const file = id => `couples/${id}.json`;
const cleanName = v => String(v || "").trim().slice(0, 40);
const cleanLang = v => (v === "th" ? "th" : "en");

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

function person(name, token, lang) {
  return { name, tokenHash: hash(token), lang, joined: new Date().toISOString(), answers: null, finished: null };
}

function whoAmI(c, token) {
  if (!TOKEN.test(token || "")) throw new HttpError(403, "bad_token");
  const h = hash(token);
  if (c.a && same(c.a.tokenHash, h)) return "a";
  if (c.b && same(c.b.tokenHash, h)) return "b";
  throw new HttpError(403, "bad_token");
}

function checkInvite(c, invite) {
  if (!INVITE.test(invite || "") || !same(c.inviteHash, hash(invite))) throw new HttpError(404, "bad_invite");
}

async function load(id) {
  if (!ID.test(id || "")) throw new HttpError(404, "not_found");
  const cur = await store.read(file(id));
  if (!cur) throw new HttpError(404, "not_found");
  return cur;
}

// Read, change, write, and retry if the other person saved at the same moment.
async function update(id, change, message) {
  for (let i = 0; i < 4; i++) {
    const cur = await load(id);
    const out = change(cur.data);
    if (!out.write) return out.result;
    if (await store.write(file(id), cur.data, cur.sha, message)) return out.result;
  }
  throw new HttpError(409, "busy");
}

const actions = {
  async create(b) {
    const name = cleanName(b.name);
    if (!name) throw new HttpError(400, "name_required");
    for (let i = 0; i < 3; i++) {
      const id = rand(8), invite = rand(8), token = rand(24);
      const c = { id, created: new Date().toISOString(), inviteHash: hash(invite), a: person(name, token, cleanLang(b.lang)), b: null };
      if (await store.write(file(id), c, null, `Couple created: ${name}`)) return { id, invite, token };
    }
    throw new HttpError(409, "busy");
  },

  async peek(b) {
    const { data: c } = await load(b.id);
    checkInvite(c, b.invite);
    return { inviter: c.a.name, taken: !!c.b };
  },

  async join(b) {
    const name = cleanName(b.name);
    if (!name) throw new HttpError(400, "name_required");
    const token = rand(24);
    return update(b.id, c => {
      checkInvite(c, b.invite);
      if (c.b) throw new HttpError(409, "taken");
      c.b = person(name, token, cleanLang(b.lang));
      return { write: true, result: { token, partner: c.a.name } };
    }, `Partner joined: ${name}`);
  },

  async answer(b) {
    const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
    const clean = {};
    for (let i = 1; i <= N; i++) {
      if (!KEYS.has(answers[i])) throw new HttpError(400, "missing_answers");
      clean[i] = answers[i];
    }
    return update(b.id, c => {
      const me = whoAmI(c, b.token);
      if (c[me].finished) return { write: false, result: { ok: true, already: true } };
      c[me].answers = clean;
      c[me].finished = new Date().toISOString();
      delete c[me].partial;
      return { write: true, result: { ok: true } };
    }, "Answers submitted");
  },

  // Answers so far while still answering. The partner only gets these once THEY have finished.
  async progress(b) {
    const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
    const clean = {};
    for (let i = 1; i <= N; i++) if (KEYS.has(answers[i])) clean[i] = answers[i];
    return update(b.id, c => {
      const me = whoAmI(c, b.token);
      if (c[me].finished || JSON.stringify(c[me].partial || {}) === JSON.stringify(clean)) return { write: false, result: { ok: true } };
      c[me].partial = clean;
      c[me].answered = Object.keys(clean).length;
      return { write: true, result: { ok: true } };
    }, "Progress");
  },

  async status(b) {
    const { data: c } = await load(b.id);
    const me = whoAmI(c, b.token), other = me === "a" ? "b" : "a";
    const info = p => ({ name: p.name, finished: !!p.finished, answered: p.finished ? N : p.answered || 0 });
    const out = { role: me, me: info(c[me]), partner: c[other] ? info(c[other]) : null };
    if (c[me].finished && c[other] && c[other].finished) out.answers = { me: c[me].answers, partner: c[other].answers };
    // Finished early? Then you may follow your partner's answers so far (they can still change them).
    else if (c[me].finished && c[other]) out.partnerSoFar = c[other].partial || {};
    return out;
  },
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!store.configured()) return res.status(500).json({ error: "storage_not_configured" });
  const b = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const fn = Object.prototype.hasOwnProperty.call(actions, b.action) ? actions[b.action] : null;
  if (!fn) return res.status(400).json({ error: "bad_action" });
  try {
    return res.status(200).json(await fn(b));
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.code });
    console.error(e);
    return res.status(502).json({ error: "storage_error" });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
