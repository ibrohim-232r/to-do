const crypto = require('crypto');
const { redis, makeToken } = require('./_lib');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { mode, username, password } = req.body || {};
    const u = String(username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(u) || String(password || '').length < 6)
      return res.status(400).json({ error: 'Логин: 3–20 символов (a-z, 0-9, _), пароль: от 6 символов' });
    if (!process.env.AUTH_SECRET) return res.status(500).json({ error: 'Не задана переменная AUTH_SECRET' });
    const key = 'user:' + u;
    if (mode === 'register') {
      const salt = crypto.randomBytes(16).toString('hex');
      const ok = await redis('SET', key, JSON.stringify({ salt, hash: hash(password, salt) }), 'NX');
      if (!ok) return res.status(409).json({ error: 'Этот логин уже занят' });
    } else {
      const raw = await redis('GET', key);
      const d = raw && JSON.parse(raw);
      if (!d || hash(password, d.salt) !== d.hash) return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    res.json({ token: makeToken(u), username: u });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
