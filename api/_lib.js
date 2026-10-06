const crypto = require('crypto');
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...cmd) {
  if (!URL_ || !TOKEN) throw new Error('База данных не подключена (Upstash Redis)');
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
const sign = s => crypto.createHmac('sha256', process.env.AUTH_SECRET || '').update(s).digest('base64url');
function makeToken(u) {
  const p = Buffer.from(JSON.stringify({ u, e: Date.now() + 30 * 864e5 })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(req) {
  const [p, s] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
  if (!p || !s || !process.env.AUTH_SECRET) return null;
  const ok = sign(p);
  if (s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url')); return d.e > Date.now() ? d.u : null; } catch { return null; }
}
module.exports = { redis, makeToken, readToken };
