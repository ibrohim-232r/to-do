const { redis, readToken } = require('./_lib');

module.exports = async (req, res) => {
  const u = readToken(req);
  if (!u) return res.status(401).json({ error: 'Нужно войти заново' });
  const key = 'tasks:' + u;
  try {
    if (req.method === 'GET') {
      const raw = await redis('GET', key);
      return res.json({ tasks: raw ? JSON.parse(raw) : [] });
    }
    if (req.method === 'PUT') {
      const tasks = req.body && req.body.tasks;
      if (!Array.isArray(tasks) || tasks.length > 2000) return res.status(400).json({ error: 'Некорректные данные' });
      await redis('SET', key, JSON.stringify(tasks));
      return res.json({ ok: true });
    }
    res.status(405).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
};
