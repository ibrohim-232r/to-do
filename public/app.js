const $ = s => document.querySelector(s);
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: k => localStorage.removeItem(k)
};
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const addDays = (n, from) => {
  const d = from ? new Date(from + 'T00:00') : new Date();
  d.setDate(d.getDate() + n);
  return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
};
const today = () => addDays(0);
const fmt = d => new Date(d + 'T00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const VIEWS = { all: 'Все', today: 'Сегодня', upcoming: 'Предстоящие', done: 'Выполненные' };
const PRIO = ['', 'средний', 'высокий', 'срочный'];

let tasks = store.get('tasks') || [], session = store.get('session');
let view = 'all', tag = '', q = '', sort = 'manual', dragId = null, editId = null, timer;

/* ---------- сервер ---------- */
async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: body && JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && session) logout(); throw new Error(j.error || 'Ошибка ' + r.status); }
  return j;
}
const setSync = t => $('#sync').textContent = t;
function save() {
  store.set('tasks', tasks);
  render();
  if (!session) return;
  setSync('Сохраняю…');
  clearTimeout(timer);
  timer = setTimeout(() => api('tasks', 'PUT', { tasks }).then(() => setSync('Сохранено')).catch(e => setSync('Нет связи: ' + e.message)), 600);
}
async function pull() {
  try {
    const { tasks: s } = await api('tasks');
    if (s.length || !tasks.length) { tasks = s; store.set('tasks', tasks); render(); }
    else save();
    setSync('Сохранено');
  } catch (e) { setSync(e.message); }
}

/* ---------- логика ---------- */
function parse(s) {
  let tg = '', prio = 0, due = '';
  s = s.replace(/#(\S+)/, (_, t) => (tg = t, ''))
    .replace(/!{1,3}/, b => (prio = b.length, ''))
    .replace(/(^|\s)(сегодня|завтра)(?=\s|$)/i, (_, a, w) => (due = addDays(w.toLowerCase() === 'сегодня' ? 0 : 1), a));
  return { title: s.trim().replace(/\s+/g, ' '), tag: tg, prio, due };
}
function toggle(x) {
  x.done = !x.done;
  if (x.done && x.repeat) {
    const n = { ...x, id: uid(), done: false, subs: x.subs.map(s => ({ ...s, d: false })), due: addDays(+x.repeat, x.due || today()) };
    tasks.splice(tasks.indexOf(x) + 1, 0, n);
  }
  save();
}
function visible() {
  const t = today();
  const l = tasks.filter(x =>
    (view === 'done' ? x.done : view === 'today' ? !x.done && x.due && x.due <= t : view === 'upcoming' ? !x.done && x.due > t : true) &&
    (!tag || x.tag === tag) && (!q || (x.title + ' ' + x.note).toLowerCase().includes(q)));
  if (sort === 'due') l.sort((a, b) => (a.due || '9') > (b.due || '9') ? 1 : -1);
  if (sort === 'prio') l.sort((a, b) => b.prio - a.prio);
  return l;
}

/* ---------- отрисовка ---------- */
function render() {
  const t = today(), act = tasks.filter(x => !x.done);
  const counts = { all: tasks.length, today: act.filter(x => x.due && x.due <= t).length, upcoming: act.filter(x => x.due > t).length, done: tasks.length - act.length };
  $('#nav').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button class="nav ${view === k ? 'on' : ''}" data-view="${k}">${v}<b>${counts[k]}</b></button>`).join('');
  const tg = [...new Set(tasks.map(x => x.tag).filter(Boolean))];
  $('#tags').innerHTML = tg.map(x => `<button class="chip ${tag === x ? 'on' : ''}" data-tag="${esc(x)}">#${esc(x)}</button>`).join('') || '<span class="muted">Тегов пока нет</span>';
  const pct = tasks.length ? Math.round(100 * counts.done / tasks.length) : 0;
  $('#bar').style.width = pct + '%';
  $('#stats').textContent = `Выполнено ${pct}%. Просрочено: ${act.filter(x => x.due && x.due < t).length}`;
  $('#acct').textContent = session ? `${session.username}: выйти` : 'Войти';
  const l = visible();
  $('#empty').hidden = l.length > 0;
  $('#list').innerHTML = l.map(x => {
    const cls = x.due && !x.done && x.due < t ? 'over' : x.due === t ? 'now' : '';
    return `<li class="task p${x.prio} ${x.done ? 'done' : ''}" draggable="${sort === 'manual'}" data-id="${x.id}">
      <input type="checkbox" class="chk" ${x.done ? 'checked' : ''}>
      <div class="body"><div class="title">${esc(x.title)}</div>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}
        <div class="meta">${x.prio ? `<span class="badge">${PRIO[x.prio]}</span>` : ''}${x.tag ? `<span class="badge">#${esc(x.tag)}</span>` : ''}${x.due ? `<span class="badge ${cls}">${fmt(x.due)}</span>` : ''}${x.repeat ? '<span class="badge">повтор</span>' : ''}${x.subs.length ? `<span class="badge">${x.subs.filter(s => s.d).length}/${x.subs.length}</span>` : ''}</div>
        ${x.subs.map((s, i) => `<label class="sub"><input type="checkbox" data-sub="${i}" ${s.d ? 'checked' : ''}><span class="${s.d ? 'sd' : ''}">${esc(s.t)}</span></label>`).join('')}
      </div>
      <div class="acts"><button data-act="edit" title="Изменить">✎</button><button data-act="del" title="Удалить">✕</button></div></li>`;
  }).join('');
}

/* ---------- события ---------- */
$('#list').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  const x = tasks.find(t => t.id === li.dataset.id);
  if (e.target.matches('.chk')) toggle(x);
  else if (e.target.dataset.sub !== undefined) { x.subs[+e.target.dataset.sub].d = e.target.checked; save(); }
  else if (e.target.dataset.act === 'del') { tasks = tasks.filter(t => t !== x); save(); }
  else if (e.target.dataset.act === 'edit') openEdit(x);
});
$('#list').addEventListener('dragstart', e => { dragId = e.target.closest('li')?.dataset.id; });
$('#list').addEventListener('dragover', e => e.preventDefault());
$('#list').addEventListener('drop', e => {
  const li = e.target.closest('li');
  if (!li || !dragId || li.dataset.id === dragId) return;
  const [m] = tasks.splice(tasks.findIndex(t => t.id === dragId), 1);
  tasks.splice(tasks.findIndex(t => t.id === li.dataset.id), 0, m);
  dragId = null; save();
});
$('#add').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const p = parse(e.target.value);
  if (!p.title) return;
  tasks.unshift({ id: uid(), note: '', done: false, repeat: '', subs: [], created: Date.now(), ...p });
  e.target.value = ''; save();
});
$('#nav').addEventListener('click', e => { if (e.target.closest('[data-view]')) { view = e.target.closest('[data-view]').dataset.view; render(); } });
$('#tags').addEventListener('click', e => { const c = e.target.closest('[data-tag]'); if (c) { tag = tag === c.dataset.tag ? '' : c.dataset.tag; render(); } });
$('#search').addEventListener('input', e => { q = e.target.value.toLowerCase(); render(); });
$('#sort').addEventListener('change', e => { sort = e.target.value; render(); });
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'n') { e.preventDefault(); $('#add').focus(); }
});

/* ---------- редактирование ---------- */
function openEdit(x) {
  editId = x.id;
  $('#e_title').value = x.title; $('#e_note').value = x.note; $('#e_prio').value = x.prio;
  $('#e_due').value = x.due; $('#e_tag').value = x.tag; $('#e_rep').value = x.repeat;
  $('#e_subs').value = x.subs.map(s => s.t).join('\n');
  $('#dlg').showModal();
}
$('#e_cancel').onclick = () => $('#dlg').close();
$('#edit').addEventListener('submit', e => {
  e.preventDefault();
  const x = tasks.find(t => t.id === editId);
  const subs = $('#e_subs').value.split('\n').map(s => s.trim()).filter(Boolean).map(t => ({ t, d: x.subs.some(s => s.t === t && s.d) }));
  Object.assign(x, { title: $('#e_title').value.trim(), note: $('#e_note').value.trim(), prio: +$('#e_prio').value, due: $('#e_due').value, tag: $('#e_tag').value.trim().replace(/^#/, ''), repeat: $('#e_rep').value, subs });
  $('#dlg').close(); save();
});

/* ---------- тема, экспорт, импорт ---------- */
const setTheme = t => { document.documentElement.dataset.theme = t; store.set('theme', t); };
setTheme(store.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#exp').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' }));
  a.download = 'taskly-' + today() + '.json'; a.click();
};
$('#imp').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d)) throw 0;
    tasks = d.map(x => ({ id: uid(), title: '', note: '', done: false, prio: 0, due: '', tag: '', repeat: '', subs: [], ...x }));
    save();
  } catch { alert('Не удалось прочитать файл. Нужен JSON, который сделал экспорт Taskly.'); }
  e.target.value = '';
};
$('#clr').onclick = () => { if (tasks.some(x => x.done) && confirm('Удалить все выполненные задачи?')) { tasks = tasks.filter(x => !x.done); save(); } };

/* ---------- вход ---------- */
function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; }
function start() { $('#auth').hidden = true; $('#app').hidden = false; render(); if (session) pull(); }
function logout() { session = null; tasks = []; store.del('session'); store.del('guest'); store.set('tasks', tasks); showAuth(); }
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const r = await api('auth', 'POST', { mode: e.submitter?.dataset.mode || 'login', username: $('#au').value, password: $('#ap').value });
    session = { token: r.token, username: r.username };
    store.set('session', session); $('#aerr').textContent = ''; start();
  } catch (err) { $('#aerr').textContent = err.message; }
});
$('#guest').onclick = () => { store.set('guest', true); start(); };
$('#acct').onclick = () => session ? logout() : showAuth();
session || store.get('guest') ? start() : showAuth();

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
let installEv;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('#install').hidden = false; });
$('#install').onclick = async () => { installEv.prompt(); await installEv.userChoice; installEv = null; $('#install').hidden = true; };
addEventListener('appinstalled', () => $('#install').hidden = true);
addEventListener('online', () => session && save());
