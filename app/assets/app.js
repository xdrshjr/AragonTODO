/* ============ AragonTask v1.3 · hub + todo + money + memo + agent ============ */
'use strict';

const $ = (s) => document.querySelector(s);
const K = 'aragontask.v1';
const KOLD = 'terra.todos.v1';

const PALETTE = ['#CC785C', '#D4A27F', '#C5A463', '#7C9885', '#7D93A8', '#9A8C9C', '#6E6A60'];
/* display names come from i18n.js: rcatName('food') -> 餐饮 / Food */
const RCATS = [
  { k: 'food', c: '#CC785C' },
  { k: 'trans', c: '#7D93A8' },
  { k: 'shop', c: '#D4A27F' },
  { k: 'home', c: '#C5A463' },
  { k: 'fun', c: '#9A8C9C' },
  { k: 'med', c: '#7C9885' },
  { k: 'edu', c: '#6E6A60' },
  { k: 'other', c: '#B5B0A0' }
];
const RSTAT = [
  { k: 'pending' },
  { k: 'submitted' },
  { k: 'done' }
];
const AISTYLES = {
  openai: { n: 'OpenAI', url: 'https://api.openai.com/v1' },
  anthropic: { n: 'Anthropic', url: 'https://api.anthropic.com' },
  custom: { n: '', url: '' }
};
const rcatName = (k) => t('rc_' + k);
const rstatName = (k) => t('rst_' + k);
const aiStyleName = (s) => (s === 'custom' ? t('ai_custom') : ((AISTYLES[s] || {}).n || s));
const GREEN = '#788C5D';
const MAX_TOOL_STEPS = 4;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtISO(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const todayISO = () => fmtISO(new Date());
const addDaysISO = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return fmtISO(d); };
const daysDiff = (iso) => Math.round((parseISO(iso) - parseISO(todayISO())) / 86400000);
const fmtAmt = (n) => {
  const v = Math.round(n * 100) / 100;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
};

/* locale-aware date formats: zh "3月8日" / en "Mar 8" */
function fmtMD(d) {
  return LANG === 'zh'
    ? (d.getMonth() + 1) + '月' + d.getDate() + '日'
    : t('mo_' + (d.getMonth() + 1)) + ' ' + d.getDate();
}
function fmtMDY(d) {
  return LANG === 'zh'
    ? d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    : t('mo_' + (d.getMonth() + 1)) + ' ' + d.getDate() + ', ' + d.getFullYear();
}
function fmtYM(y, m) {
  return LANG === 'zh' ? y + '年' + m + '月' : t('mo_' + m) + ' ' + y;
}

function dueLabel(iso) {
  if (!iso) return null;
  const n = daysDiff(iso);
  if (n === 0) return t('d_today');
  if (n === 1) return t('d_tomorrow');
  if (n === 2) return t('d_d2');
  if (n === -1) return t('d_yesterday');
  if (n < -1) return t('d_overdue', -n);
  if (n <= 7) return t('wk_' + parseISO(iso).getDay());
  return fmtMD(parseISO(iso));
}
function dayLabelLong(iso) {
  const n = daysDiff(iso);
  if (n === 0) return t('d_today');
  if (n === -1) return t('d_yesterday');
  if (n === -2) return t('d_before_yesterday');
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (sameYear ? fmtMD(d) : fmtMDY(d)) + ' · ' + t('wk_' + d.getDay());
}

/* ---------- native net bridge (no CORS) ---------- */
let netSeq = 0;
const netPend = {};
window.__netDone = (id, status, text) => {
  const p = netPend[id];
  if (p) { delete netPend[id]; clearTimeout(p.t); p.res({ status, text: text || '' }); }
};
function net(method, url, headers, body) {
  if (window.AndroidNet && window.AndroidNet.request) {
    return new Promise((res) => {
      const id = 'n' + (++netSeq);
      netPend[id] = {
        res,
        t: setTimeout(() => { delete netPend[id]; res({ status: -1, text: '{"error":"' + t('net_timeout') + '"}' }); }, 90000)
      };
      try {
        AndroidNet.request(method, url, JSON.stringify(headers), body || '', id);
      } catch (e) {
        delete netPend[id];
        res({ status: -1, text: '{"error":"' + String(e).replace(/"/g, "'") + '"}' });
      }
    });
  }
  return fetch(url, { method, headers, body: body || undefined })
    .then(async (r) => ({ status: r.status, text: await r.text() }))
    .catch((e) => ({ status: -1, text: String(e) }));
}

/* ---------- streaming support ---------- */
window.__netChunk = (id, chunk) => {
  const p = netPend[id];
  if (p && p.onChunk) p.onChunk(String(chunk || ''));
};
const tryParse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

async function streamLLM(p, sys, messages, onChunk) {
  const eps = apiUrls(p.style, p.baseUrl);
  const mkBody = (stream) => p.style === 'anthropic'
    ? { model: p.model, max_tokens: 1024, system: sys, stream, messages }
    : { model: p.model, stream, messages: [{ role: 'system', content: sys }].concat(messages), max_tokens: 1024 };
  let got = false;
  const consume = (text) => {
    String(text || '').split('\n').forEach((l) => {
      l = l.trim();
      if (l.indexOf('data:') !== 0) return;
      const payload = l.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      const j = tryParse(payload);
      if (!j) return;
      if (p.style === 'anthropic') {
        if (j.type === 'content_block_delta' && j.delta && typeof j.delta.text === 'string') {
          got = true; onChunk(j.delta.text);
        }
      } else {
        const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message);
        if (d && typeof d.content === 'string') { got = true; onChunk(d.content); }
      }
    });
  };

  /* 1) browser fetch streaming */
  if (!window.AndroidNet) {
    try {
      const rr = await fetch(eps.chat, {
        method: 'POST',
        headers: aiHeaders(p, true),
        body: JSON.stringify(mkBody(true))
      });
      if (rr.ok && rr.body && rr.body.getReader) {
        const reader = rr.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const st = await reader.read();
          if (st.done) break;
          consume(dec.decode(st.value, { stream: true }));
        }
        if (got) return;
      }
    } catch (e) { /* fall through */ }
  } else if (AndroidNet.stream) {
    /* 2) native bridge streaming */
    await new Promise((res) => {
      const id = 's' + (++netSeq);
      netPend[id] = {
        res,
        onChunk: consume,
        t: setTimeout(() => { delete netPend[id]; res(); }, 120000)
      };
      try {
        AndroidNet.stream('POST', eps.chat, JSON.stringify(aiHeaders(p, true)), JSON.stringify(mkBody(true)), id);
      } catch (e) {
        delete netPend[id];
        res();
      }
    });
    if (got) return;
  }

  /* 3) fallback: endpoint gave no SSE stream — deliver the complete text
     honestly in one shot (no simulated typing) */
  const out = await callLLM(p, sys, messages);
  if (out) onChunk(out);
}

/* ---------- tiny markdown renderer ---------- */
function mdInline(s) {
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a data-act="link" data-id="$2">$1</a>');
  return s;
}
function mdToHtml(md) {
  const lines = String(md || '').split('\n');
  let h = '', para = [], list = null, code = null;
  const flushP = () => { if (para.length) { h += '<p>' + para.map(mdInline).join('<br>') + '</p>'; para = []; } };
  const flushL = () => {
    if (list) {
      h += '<' + list.t + '>' + list.items.map((i) => '<li>' + mdInline(i) + '</li>').join('') + '</' + list.t + '>';
      list = null;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      if (code !== null) { h += '<pre><code>' + esc(code.join('\n')) + '</code></pre>'; code = null; }
      else { flushP(); flushL(); code = []; }
      continue;
    }
    if (code !== null) { code.push(line); continue; }
    if (/^\s*$/.test(line)) { flushP(); flushL(); continue; }
    let m;
    if ((m = line.match(/^\s*(#{1,4})\s+(.*)$/))) { flushP(); flushL(); h += '<h' + Math.min(m[1].length + 2, 5) + '>' + mdInline(m[2]) + '</h>'; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushP(); flushL(); h += '<hr>'; continue; }
    if ((m = line.match(/^\s*&gt;\s?(.*)$/))) { flushP(); flushL(); h += '<blockquote>' + mdInline(m[1]) + '</blockquote>'; continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushP();
      if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = line.match(/^\s*\d+[.、)]\s+(.*)$/))) {
      flushP();
      if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushL();
    para.push(line);
  }
  if (code !== null) h += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
  flushP();
  flushL();
  return h;
}

/* ---------- state ---------- */
let S = load();
if (!S.budget) S.budget = { monthly: null };
let F = { cat: 'all', showDone: false };
let V = 'hub';
let M = { month: todayISO().slice(0, 7), filter: 'all' };
let expandedId = null;
let expandedRid = null;
let undoFn = null;
let chatBusy = false;

function load() {
  let s = null;
  try {
    const raw = localStorage.getItem(K) || localStorage.getItem(KOLD);
    if (raw) s = JSON.parse(raw);
  } catch (e) { s = null; }
  if (s && Array.isArray(s.tasks) && Array.isArray(s.cats)) {
    if (!Array.isArray(s.records)) s.records = [];
    if (!Array.isArray(s.memos)) s.memos = [];
    if (!Array.isArray(s.chat)) s.chat = [];
    if (!s.ai || typeof s.ai !== 'object') s.ai = { profiles: [], def: null };
    if (!Array.isArray(s.ai.profiles)) s.ai.profiles = [];
    return s;
  }
  s = seed();
  persist(s);
  return s;
}
function persist(st) {
  try { localStorage.setItem(K, JSON.stringify(st || S)); } catch (e) { /* ignore */ }
}
function seed() {
  const td = todayISO();
  const now = Date.now();
  const d0 = new Date();
  const first = fmtISO(new Date(d0.getFullYear(), d0.getMonth(), 1));
  return {
    cats: [
      { id: 'c1', name: t('seed_cat1'), color: '#CC785C' },
      { id: 'c2', name: t('seed_cat2'), color: '#D4A27F' },
      { id: 'c3', name: t('seed_cat3'), color: '#7C9885' }
    ],
    tasks: [
      { id: uid(), title: t('seed_t1'), note: t('seed_t1n'), catId: 'c1', due: td, done: false, createdAt: now - 5e6, doneAt: null },
      { id: uid(), title: t('seed_t2'), note: '', catId: 'c1', due: td, done: true, createdAt: now - 8e6, doneAt: now - 3e5 },
      { id: uid(), title: t('seed_t3'), note: '', catId: 'c3', due: td, done: false, createdAt: now - 4e6, doneAt: null },
      { id: uid(), title: t('seed_t4'), note: '', catId: 'c2', due: null, done: false, createdAt: now - 3e6, doneAt: null },
      { id: uid(), title: t('seed_t5'), note: '', catId: 'c2', due: addDaysISO(1), done: false, createdAt: now - 2e6, doneAt: null },
      { id: uid(), title: t('seed_t6'), note: '', catId: 'c3', due: null, done: false, createdAt: now - 1e6, doneAt: null }
    ],
    records: [
      { id: uid(), type: 'out', amount: 18, cat: 'food', title: t('seed_r1'), note: '', date: td, reimb: 'none', createdAt: now - 2e6 },
      { id: uid(), type: 'out', amount: 42.5, cat: 'trans', title: t('seed_r2'), note: t('seed_r2n'), date: td, reimb: 'pending', createdAt: now - 3e6 },
      { id: uid(), type: 'out', amount: 89, cat: 'edu', title: t('seed_r3'), note: t('seed_r3n'), date: addDaysISO(-1), reimb: 'done', createdAt: now - 9e6 },
      { id: uid(), type: 'out', amount: 35, cat: 'shop', title: t('seed_r4'), note: '', date: addDaysISO(-1), reimb: 'none', createdAt: now - 1e7 },
      { id: uid(), type: 'out', amount: 128, cat: 'med', title: t('seed_r5'), note: '', date: addDaysISO(-2), reimb: 'submitted', createdAt: now - 1.2e7 },
      { id: uid(), type: 'in', amount: 1200, cat: null, title: t('seed_r6'), note: '', date: first, reimb: 'none', createdAt: now - 2e7 }
    ],
    memos: [],
    chat: [],
    ai: { profiles: [], def: null }
  };
}

function catOf(t) {
  return S.cats.find((c) => c.id === t.catId) || null;
}
function rcatOf(r) {
  return RCATS.find((c) => c.k === r.cat) || null;
}
function rcatByName(nm) {
  if (!nm) return null;
  const s = String(nm).trim();
  const sl = s.toLowerCase();
  return RCATS.find((c) =>
    I18N.zh['rc_' + c.k] === s ||
    String(I18N.en['rc_' + c.k]).toLowerCase() === sl ||
    c.k === sl) || null;
}
function rstatOf(r) {
  return RSTAT.find((x) => x.k === r.reimb) || null;
}
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function memoColor(catName) {
  const c = S.cats.find((x) => x.name === catName);
  return c ? c.color : hashColor(catName || 'uncat');
}

/* ---------- header ---------- */
function renderHeader() {
  const d = new Date();
  $('#hd-date').textContent = LANG === 'zh'
    ? fmtMD(d) + ' · ' + t('wk_' + d.getDay())
    : t('wkf_' + d.getDay()) + ', ' + t('mo_' + (d.getMonth() + 1)) + ' ' + d.getDate();
  const h = d.getHours();
  let hi = t('hi_night');
  if (h >= 5 && h < 11) hi = t('hi_morning');
  else if (h >= 11 && h < 13) hi = t('hi_noon');
  else if (h >= 13 && h < 18) hi = t('hi_afternoon');
  else if (h >= 18 && h < 23) hi = t('hi_evening');
  $('#hd-hi').textContent = hi;
}

/* ---------- hub ---------- */
function renderHub() {
  const tdy = todayISO();
  const pendToday = S.tasks.filter((x) => !x.done && x.due && x.due <= tdy).length;
  const pendAll = S.tasks.filter((x) => !x.done).length;
  const overdue = S.tasks.filter((x) => !x.done && x.due && daysDiff(x.due) < 0).length;
  $('#hub-todo').innerHTML = (pendToday ? t('hub_due_today', pendToday) : (pendAll ? t('hub_pending', pendAll) : t('hub_all_done'))) +
    (overdue ? ' <span class="odv">' + t('hub_overdue', overdue) + '</span>' : '');
  const mo = S.records.filter((r) => (r.date || '').slice(0, 7) === tdy.slice(0, 7) && r.type === 'out')
    .reduce((a, r) => a + (r.amount || 0), 0);
  $('#hub-money').textContent = t('hub_month_spend', fmtAmt(mo));
  $('#hub-memo').textContent = S.memos.length ? t('hub_memos', S.memos.length) : t('hub_no_memos');
}

/* ---------- todo: hero ---------- */
function renderHero() {
  const tdy = todayISO();
  const doneToday = S.tasks.filter((x) => x.done && x.doneAt && fmtISO(new Date(x.doneAt)) === tdy).length;
  const pendingToday = S.tasks.filter((x) => !x.done && x.due && x.due <= tdy).length;
  const all = doneToday + pendingToday;
  const p = all ? doneToday / all : 0;
  const C = 163.4;
  requestAnimationFrame(() => { $('#ring').style.strokeDashoffset = String(C * (1 - p)); });
  $('#hero-done').textContent = doneToday;
  $('#hero-all').textContent = all;
  $('#hero-sub').textContent =
    all === 0 ? t('hero_none')
    : p === 1 ? t('hero_done_all')
    : t('hero_left', all - doneToday);
}

/* ---------- todo: chips ---------- */
function renderChips() {
  const pending = S.tasks.filter((x) => !x.done);
  let h = chipHTML('all', null, t('chip_all'), pending.length, F.cat === 'all');
  S.cats.forEach((c) => {
    const n = pending.filter((x) => x.catId === c.id).length;
    h += chipHTML(c.id, c.color, c.name, n, F.cat === c.id);
  });
  h += '<button class="chip chip--ic" data-act="manage" aria-label="' + esc(t('manage_aria')) + '">' +
       '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h7M12.5 4H14M2 12h3M8.5 12H14M12 2v4M7 10v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10.5" cy="4" r="1.8" stroke="currentColor" stroke-width="1.6"/><circle cx="6.5" cy="12" r="1.8" stroke="currentColor" stroke-width="1.6"/></svg></button>';
  $('#chips').innerHTML = h;
}
function chipHTML(id, color, name, n, on) {
  const dot = color
    ? '<i class="dot" style="background:' + color + '"></i>'
    : '<svg class="dot" style="width:8px;height:8px" viewBox="0 0 8 8"><rect x="1" y="1" width="6" height="6" rx="2" fill="none" stroke="' + (on ? '#F5F2E9' : '#8B8677') + '" stroke-width="1.3"/></svg>';
  return '<button class="chip' + (on ? ' on' : '') + '" data-act="filter" data-id="' + id + '">' +
    dot + esc(name) + '<span class="ct">' + n + '</span></button>';
}

/* ---------- todo: list ---------- */
function visibleTasks(done) {
  let arr = S.tasks.filter((t) => !!t.done === done);
  if (F.cat !== 'all') arr = arr.filter((t) => t.catId === F.cat);
  arr.sort((a, b) => {
    if (done) return (b.doneAt || 0) - (a.doneAt || 0);
    const da = a.due || '9999', db = b.due || '9999';
    if (da !== db) return da < db ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return arr;
}

function rowHTML(tk, i) {
  const c = catOf(tk);
  const overdue = !tk.done && tk.due && daysDiff(tk.due) < 0;
  const due = tk.due ? '<span class="due' + (overdue ? ' od' : '') + '">' + esc(dueLabel(tk.due)) + '</span>' : '';
  const meta =
    '<div class="meta">' +
    (c ? '<i class="mdot" style="background:' + c.color + '"></i><span>' + esc(c.name) + '</span>'
       : '<i class="mdot" style="background:#B5B0A0"></i><span>' + esc(t('uncat')) + '</span>') +
    (tk.due ? '<span class="sep">·</span>' + due : '') +
    (tk.repeat ? '<span class="sep">·</span><span class="rp">↻ ' + esc(repLabel(tk.repeat)) + '</span>' : '') +
    '</div>';
  const detail =
    '<div class="detail"><div class="detail-in">' +
    (tk.note ? '<div class="note">' + esc(tk.note) + '</div>' : '') +
    '<div class="acts">' +
    '<button class="act-ed" data-act="edit" data-id="' + tk.id + '">' + esc(t('edit')) + '</button>' +
    '<button class="act-del" data-act="del" data-id="' + tk.id + '">' + esc(t('del')) + '</button>' +
    '</div></div></div>';
  return (
    '<div class="row' + (tk.done ? ' done-row' : '') + (expandedId === tk.id ? ' x' : '') + '" data-id="' + tk.id + '" style="animation-delay:' + Math.min(i, 8) * 28 + 'ms">' +
    '<button class="cbx" data-act="toggle" data-id="' + tk.id + '" aria-label="' + esc(t('done_sec')) + '">' +
    '<svg viewBox="0 0 12 12"><path d="M2.2 6.4l2.6 2.6L9.8 3.2"/></svg></button>' +
    '<div class="rmain" data-act="expand" data-id="' + tk.id + '">' +
    '<div class="ttl">' + esc(tk.title) + '</div>' + meta + detail +
    '</div>' +
    '<svg class="chev" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</div>'
  );
}

function renderList() {
  const todo = visibleTasks(false);
  $('#todo-cnt').textContent = todo.length ? String(todo.length) : '';
  $('#list').innerHTML = todo.map(rowHTML).join('');
  $('#list').style.display = todo.length ? '' : 'none';

  const empty = $('#empty');
  if (!todo.length) {
    const cname = F.cat === 'all' ? null : (S.cats.find((c) => c.id === F.cat) || {}).name;
    $('#empty-t').textContent = cname ? t('empty_quiet') : t('empty_ok');
    $('#empty-p').textContent = cname ? t('empty_cat_p', cname) : t('empty_p');
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }

  const doneArr = visibleTasks(true);
  $('#done-cnt').textContent = doneArr.length ? String(doneArr.length) : '';
  $('#done-toggle').style.visibility = doneArr.length ? 'visible' : 'hidden';
  $('#done-toggle').classList.toggle('open', F.showDone);
  const dl = $('#donelist');
  dl.hidden = !F.showDone || !doneArr.length;
  dl.innerHTML = doneArr.map(rowHTML).join('');
}

/* ---------- money ---------- */
function monthRecords() {
  return S.records.filter((r) => r.date && r.date.slice(0, 7) === M.month);
}
function mFiltered() {
  const rs = monthRecords();
  if (M.filter === 'in') return rs.filter((r) => r.type === 'in');
  if (M.filter === 'reimb') return rs.filter((r) => r.reimb !== 'none');
  if (M.filter !== 'all') return rs.filter((r) => r.type === 'out' && r.cat === M.filter);
  return rs;
}
function shiftMonth(delta) {
  const [y, m] = M.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  M.month = d.getFullYear() + '-' + p(d.getMonth() + 1);
}

function renderMoney() {
  const rs = monthRecords();
  const out = rs.filter((r) => r.type === 'out').reduce((a, r) => a + (r.amount || 0), 0);
  const inn = rs.filter((r) => r.type === 'in').reduce((a, r) => a + (r.amount || 0), 0);
  const bal = inn - out;

  const isCur = M.month === todayISO().slice(0, 7);
  const [y, m] = M.month.split('-').map(Number);
  $('#m-lb').textContent = isCur ? t('m_spend_cur') : t('m_spend_m', fmtYM(y, m));
  $('#m-month').textContent = fmtYM(y, m);
  $('#m-out').textContent = fmtAmt(out);
  $('#m-sub').textContent = t('m_sub', fmtAmt(inn), (bal >= 0 ? '+' : '-') + fmtAmt(Math.abs(bal)));

  /* budget mini bar */
  const bud = S.budget && S.budget.monthly;
  const mini = $('#bud-mini');
  if (bud && isCur) {
    mini.hidden = false;
    const p = out / bud;
    const f = $('#bud-mini-fill');
    f.style.width = Math.min(p, 1) * 100 + '%';
    f.classList.toggle('warn', p >= 0.8 && p < 1);
    f.classList.toggle('over', p >= 1);
    mini.title = p >= 1 ? t('bud_over_tt') : t('bud_pct_tt', Math.round(p * 100));
  } else mini.hidden = true;

  const pend = S.records
    .filter((r) => r.reimb === 'pending' || r.reimb === 'submitted')
    .reduce((a, r) => a + (r.amount || 0), 0);
  $('#reimb-sum').textContent = '¥' + fmtAmt(pend);
  $('#reimb-chip').classList.toggle('none', pend === 0);

  renderMChips();
  renderMGroups();
}

function renderMChips() {
  const rs = monthRecords();
  let h = mchipHTML('all', null, t('chip_all'), rs.length, M.filter === 'all');
  RCATS.forEach((c) => {
    const n = rs.filter((r) => r.type === 'out' && r.cat === c.k).length;
    if (n) h += mchipHTML(c.k, c.c, rcatName(c.k), n, M.filter === c.k);
  });
  const nin = rs.filter((r) => r.type === 'in').length;
  if (nin) h += mchipHTML('in', GREEN, t('chip_in'), nin, M.filter === 'in');
  const nrb = rs.filter((r) => r.reimb !== 'none').length;
  if (nrb) h += mchipHTML('reimb', '#CC785C', t('chip_reimb'), nrb, M.filter === 'reimb');
  $('#m-chips').innerHTML = h;
}
function mchipHTML(id, color, name, n, on) {
  return '<button class="chip' + (on ? ' on' : '') + '" data-act="mfilter" data-id="' + id + '">' +
    '<i class="dot" style="background:' + color + '"></i>' + esc(name) +
    '<span class="ct">' + n + '</span></button>';
}

function recRowHTML(r, i) {
  const c = rcatOf(r);
  const isIn = r.type === 'in';
  const dotC = isIn ? GREEN : (c ? c.c : '#B5B0A0');
  const catName = isIn ? t('rt_in') : (c ? rcatName(c.k) : t('uncat'));
  const st = rstatOf(r);
  const badge = (!isIn && st && r.reimb !== 'none')
    ? '<span class="rb rb-' + r.reimb + '">' + esc(rstatName(r.reimb)) + '</span>' : '';
  const detail =
    '<div class="detail"><div class="detail-in">' +
    (r.note ? '<div class="note">' + esc(r.note) + '</div>' : '') +
    (!isIn && r.reimb !== 'none'
      ? '<div class="st-wrap"><span class="st-lb">' + esc(t('reimb_state')) + '</span><div class="st-pills">' +
        RSTAT.map((x) =>
          '<button class="chip s' + (r.reimb === x.k ? ' sel' : '') + '" data-act="rst" data-id="' + r.id + '" data-st="' + x.k + '">' + esc(rstatName(x.k)) + '</button>'
        ).join('') + '</div></div>'
      : '') +
    '<div class="acts">' +
    '<button class="act-ed" data-act="redit" data-id="' + r.id + '">' + esc(t('edit')) + '</button>' +
    '<button class="act-del" data-act="rdel" data-id="' + r.id + '">' + esc(t('del')) + '</button>' +
    '</div></div></div>';
  return (
    '<div class="row m-row' + (expandedRid === r.id ? ' x' : '') + '" style="animation-delay:' + Math.min(i, 8) * 24 + 'ms">' +
    '<i class="mdot" style="background:' + dotC + '"></i>' +
    '<div class="rmain" data-act="mexp" data-id="' + r.id + '">' +
    '<div class="ttl">' + esc(r.title || catName) + badge + '</div>' +
    '<div class="meta"><span>' + catName + '</span></div>' + detail +
    '</div>' +
    '<div class="amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '-') + fmtAmt(r.amount || 0) + '</div>' +
    '<svg class="chev" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '</div>'
  );
}

function renderMGroups() {
  const arr = mFiltered().slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const empty = $('#m-empty');
  if (!arr.length) {
      $('#m-empty-t').textContent = M.month !== todayISO().slice(0, 7) ? t('m_empty_nm') : t('m_empty');
      $('#m-empty-p').textContent = t('m_empty_p');
    empty.hidden = false;
    $('#m-groups').innerHTML = '';
    return;
  }
  empty.hidden = true;
  const days = [];
  arr.forEach((r) => { if (!days.includes(r.date)) days.push(r.date); });
  let h = '';
  days.forEach((d) => {
    const rows = arr.filter((r) => r.date === d);
    const o = rows.filter((r) => r.type === 'out').reduce((a, r) => a + (r.amount || 0), 0);
    const i = rows.filter((r) => r.type === 'in').reduce((a, r) => a + (r.amount || 0), 0);
      const sum = t('m_out', fmtAmt(o)) + (i ? ' · ' + t('m_in', fmtAmt(i)) : '');
    h += '<div class="m-day"><div class="m-dh"><b>' + esc(dayLabelLong(d)) + '</b>' +
      '<span class="m-dsum">' + sum + '</span></div>' +
      '<div class="list card">' + rows.map(recRowHTML).join('') + '</div></div>';
  });
  $('#m-groups').innerHTML = h;
}

/* ---------- view switch ---------- */
const VIEWS = ['hub', 'todo', 'money', 'memo', 'agent'];
function setView(v) {
  if (VIEWS.indexOf(v) < 0) v = 'hub';
  V = v;
  VIEWS.forEach((x) => { $('#view-' + x).hidden = x !== v; });
  const fab = $('#fab');
  const spacer = $('#spacer');
  if (v === 'todo') { $('#fab-t').textContent = t('fab_todo'); }
  else if (v === 'money') { $('#fab-t').textContent = t('fab_money'); }
  else if (v === 'memo') { $('#fab-t').textContent = t('fab_memo'); }
  fab.style.display = spacer.style.display = (v === 'hub' || v === 'agent') ? 'none' : '';
  document.body.classList.toggle('agent-mode', v === 'agent');
  expandedId = null;
  expandedRid = null;
  if (v === 'hub') renderHub();
  else if (v === 'money') renderMoney();
  else if (v === 'memo') renderMemoView();
  else if (v === 'agent') renderChat();
  else { renderChips(); renderList(); }
}

function renderAll() {
  renderHub();
  renderHero();
  renderChips();
  renderList();
  if (V === 'money') renderMoney();
  if (V === 'memo') renderMemoView();
  if (V === 'agent') renderChat();
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, undo) {
  $('#toast-msg').textContent = msg;
  const un = $('#toast-un');
  undoFn = undo || null;
  un.hidden = !undo;
  const el = $('#toast');
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 3200);
}

/* ---------- task sheet ---------- */
const taskSheet = $('#task-sheet');
let editingTask = null;
let selCat = null;
let selDue = null;
let selRepeat = null;

function openTaskSheet(tk) {
  editingTask = tk || null;
  $('#ts-h').textContent = tk ? t('ts_edit') : t('ts_new');
  $('#ts-title').value = tk ? tk.title : '';
  $('#ts-note').value = tk ? (tk.note || '') : '';
  selCat = tk ? tk.catId : (F.cat !== 'all' ? F.cat : (S.cats[0] ? S.cats[0].id : null));
  selDue = tk ? (tk.due || null) : null;
  selRepeat = tk ? (tk.repeat || null) : null;
  $('#ts-del').hidden = !tk;
  renderSheetCats();
  renderSheetDates();
  renderRepeat();
  refreshSaveBtn();
  openSheet(taskSheet);
  setTimeout(() => { if (!tk) $('#ts-title').focus(); }, 380);
}
function renderSheetCats() {
  let h = S.cats.map((c) =>
    '<button class="chip s' + (selCat === c.id ? ' sel' : '') + '" data-act="sc" data-id="' + c.id + '">' +
    '<i class="dot" style="background:' + c.color + '"></i>' + esc(c.name) + '</button>').join('');
  h += '<button class="chip s' + (selCat === null ? ' sel' : '') + '" data-act="sc" data-id="">' + esc(t('uncat')) + '</button>';
  $('#ts-cats').innerHTML = h;
}
function renderSheetDates() {
  const opts = [
    { v: null, label: t('d_none') },
    { v: todayISO(), label: t('d_today') },
    { v: addDaysISO(1), label: t('d_tomorrow') },
    { v: addDaysISO(2), label: t('d_d2') }
  ];
  const matched = opts.some((o) => o.v === selDue);
  let h = opts.map((o) =>
    '<button class="chip s' + (selDue === o.v ? ' sel' : '') + '" data-act="sd" data-id="' + (o.v || '') + '">' +
    o.label + '</button>').join('');
  const custom = (!matched && selDue) ? dueLabel(selDue) : t('pick_date');
  h += '<button class="chip s' + ((!matched && selDue) ? ' sel' : '') + '" data-act="sd-pick">' + esc(custom) + '</button>';
  $('#ts-dates').innerHTML = h;
}
function refreshSaveBtn() {
  $('#ts-save').disabled = !$('#ts-title').value.trim();
}
function saveTask() {
  const title = $('#ts-title').value.trim();
  if (!title) return;
  if (selRepeat && !selDue) selDue = todayISO(); /* repeating tasks need a start date */
  const note = $('#ts-note').value.trim();
  if (editingTask) {
    editingTask.title = title;
    editingTask.note = note;
    editingTask.catId = selCat;
    editingTask.due = selDue;
    editingTask.repeat = selRepeat;
  } else {
    S.tasks.push({
      id: uid(), title, note, catId: selCat, due: selDue, repeat: selRepeat,
      done: false, createdAt: Date.now(), doneAt: null
    });
  }
  persist();
  renderAll();
  toast(editingTask ? t('toast_task_upd') : t('toast_task_add', title));
  closeSheets();
}

function deleteTask(id) {
  const i = S.tasks.findIndex((t) => t.id === id);
  if (i < 0) return;
  const removed = S.tasks[i];
  S.tasks.splice(i, 1);
  if (expandedId === id) expandedId = null;
  persist();
  renderAll();
  toast(t('toast_task_del', removed.title), () => {
    S.tasks.push(removed);
    persist();
    renderAll();
  });
}

/* ---------- record sheet ---------- */
const recSheet = $('#rec-sheet');
let editingRec = null;
let selRType = 'out';
let selRCat = 'food';
let selRDate = null;

function openRecSheet(r) {
  editingRec = r || null;
  $('#rs-h').textContent = r ? t('rs_edit') : t('rs_new');
  selRType = r ? r.type : 'out';
  selRCat = r && r.cat ? r.cat : mDefaultCat();
  selRDate = r ? r.date : todayISO();
  $('#rs-amt').value = r ? String(r.amount) : '';
  $('#rs-title').value = r ? (r.title || '') : '';
  $('#rs-reimb').checked = !!r && r.reimb !== 'none';
  $('#rs-del').hidden = !r;
  renderRType();
  renderRCats();
  renderRDates();
  refreshRSBtn();
  openSheet(recSheet);
  setTimeout(() => { const a = $('#rs-amt'); a.focus(); if (r) a.select(); }, 380);
  setTimeout(() => { if (!r) $('#rs-amt').focus(); }, 380);
}
function mDefaultCat() {
  const rs = monthRecords().filter((r) => r.type === 'out');
  if (rs.length) return rs[rs.length - 1].cat || 'food';
  return 'food';
}
function renderRType() {
  document.querySelectorAll('#rs-type .ts-b').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === selRType);
  });
  const isIn = selRType === 'in';
  $('#rs-catwrap').style.display = isIn ? 'none' : '';
  $('#rs-reimbrow').classList.toggle('off', isIn);
}
function renderRCats() {
  $('#rs-cats').innerHTML = RCATS.map((c) =>
    '<button class="chip s' + (selRCat === c.k ? ' sel' : '') + '" data-act="rc" data-id="' + c.k + '">' +
    '<i class="dot" style="background:' + c.c + '"></i>' + esc(c.n) + '</button>').join('');
}
function renderRDates() {
  const opts = [
    { v: todayISO(), label: t('d_today') },
    { v: addDaysISO(-1), label: t('d_yesterday') },
    { v: addDaysISO(-2), label: t('d_before_yesterday') }
  ];
  const matched = opts.some((o) => o.v === selRDate);
  let h = opts.map((o) =>
    '<button class="chip s' + (selRDate === o.v ? ' sel' : '') + '" data-act="rd" data-id="' + o.v + '">' +
    o.label + '</button>').join('');
  const custom = (!matched && selRDate) ? dueLabel(selRDate) : t('pick_date');
  h += '<button class="chip s' + ((!matched && selRDate) ? ' sel' : '') + '" data-act="rd-pick">' + esc(custom) + '</button>';
  $('#rs-dates').innerHTML = h;
}
function refreshRSBtn() {
  /* keep the button clickable: saveRec validates and explains with a toast
     (a silently disabled button gives the user no reason why) */
  $('#rs-save').disabled = false;
}
function saveRec() {
  const amount = Math.round(parseFloat($('#rs-amt').value) * 100) / 100;
  if (!(amount > 0)) {
    toast(t('rs_need_amt'));
    const a = $('#rs-amt');
    a.focus(); a.select();
    return;
  }
  const title = $('#rs-title').value.trim();
  const catName = selRType === 'out' ? rcatName(selRCat) : t('rt_in');
  const reimb = (selRType === 'out' && $('#rs-reimb').checked) ? 'pending' : 'none';
  if (editingRec) {
    editingRec.type = selRType;
    editingRec.amount = amount;
    editingRec.title = title;
    editingRec.cat = selRType === 'out' ? selRCat : null;
    editingRec.date = selRDate;
    if (reimb === 'none') editingRec.reimb = 'none';
    else if (editingRec.reimb === 'none') editingRec.reimb = 'pending';
  } else {
    S.records.push({
      id: uid(), type: selRType, amount,
      title: title || catName,
      cat: selRType === 'out' ? selRCat : null,
      note: '',
      date: selRDate, reimb,
      createdAt: Date.now()
    });
  }
  if (selRDate && selRDate.slice(0, 7) !== M.month) M.month = selRDate.slice(0, 7);
  persist();
  renderAll();
  toast(editingRec ? t('toast_rec_upd', (selRType === 'out' ? '−' : '+') + fmtAmt(amount)) : t('toast_rec_log', (selRType === 'out' ? '−' : '+') + fmtAmt(amount)));
  closeSheets();
}
function deleteRec(id) {
  const i = S.records.findIndex((r) => r.id === id);
  if (i < 0) return;
  const removed = S.records[i];
  S.records.splice(i, 1);
  if (expandedRid === id) expandedRid = null;
  persist();
  renderAll();
  toast(t('toast_rec_del', (removed.type === 'in' ? '+' : '-') + fmtAmt(removed.amount)), () => {
    S.records.push(removed);
    persist();
    renderAll();
  });
}

/* ---------- AI: endpoints & calls ---------- */
function apiUrls(style, baseUrl) {
  let b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (style === 'anthropic') {
    if (!/\/v\d+$/.test(b)) b += '/v1';
    return { chat: b + '/messages', models: b + '/models' };
  }
  if (/\/(chat\/completions|messages|models|completions)$/.test(b)) {
    b = b.replace(/\/(chat\/completions|messages|models|completions)$/, '');
  } else if (!/\/v\d+$/.test(b) && !/\/api\/?/.test(b)) {
    b += '/v1';
  }
  return { chat: b + '/chat/completions', models: b + '/models' };
}
function aiHeaders(p, withBody) {
  const h = {};
  if (withBody) h['Content-Type'] = 'application/json';
  if (p.style === 'anthropic') {
    if (p.apiKey) h['x-api-key'] = p.apiKey;
    h['anthropic-version'] = '2023-06-01';
  } else if (p.apiKey) {
    h['Authorization'] = 'Bearer ' + p.apiKey;
  }
  if (p.extraHeaders) {
    try { Object.assign(h, JSON.parse(p.extraHeaders)); } catch (e) { /* ignore */ }
  }
  return h;
}
async function fetchModels(p) {
  const eps = apiUrls(p.style, p.baseUrl);
  const r = await net('GET', eps.models, aiHeaders(p, false), '');
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' ' + String(r.text).slice(0, 120));
  const j = JSON.parse(r.text);
  const arr = (j.data || j.models || (Array.isArray(j) ? j : []))
    .map((x) => x.id || x.name || String(x))
    .filter(Boolean);
  return arr.slice(0, 40);
}
async function callLLM(p, sys, messages) {
  const eps = apiUrls(p.style, p.baseUrl);
  let body;
  if (p.style === 'anthropic') {
    body = JSON.stringify({ model: p.model, max_tokens: 1024, system: sys, messages });
  } else {
    body = JSON.stringify({ model: p.model, messages: [{ role: 'system', content: sys }].concat(messages), max_tokens: 1024 });
  }
  const r = await net('POST', eps.chat, aiHeaders(p, true), body);
  if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' ' + String(r.text).slice(0, 160));
  const j = JSON.parse(r.text);
  if (p.style === 'anthropic') {
    return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}
function defProfile() {
  if (!S.ai.profiles.length) return null;
  return S.ai.profiles.find((x) => x.id === S.ai.def) || S.ai.profiles[0];
}

/* ---------- agent tools ---------- */
async function runTool(tool) {
  const name = tool.name;
  const args = tool.args || {};
  if (name === 'web_search') {
    const q = String(args.query || '').slice(0, 200);
    if (!q) return { ok: false, text: t('ag_missing_query'), summary: t('ag_search_bad') };
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const r = await net('GET', url, {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'Accept-Language': LANG === 'zh' ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9'
    }, '');
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, text: t('ag_search_http', r.status), summary: t('ag_search_fail', q) };
    }
    const doc = new DOMParser().parseFromString(r.text, 'text/html');
    const out = [];
    doc.querySelectorAll('.result, .web-result').forEach((el) => {
      if (out.length >= 6) return;
      const a = el.querySelector('a.result__a');
      const sn = el.querySelector('.result__snippet');
      if (!a) return;
      const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const title = strip(a.textContent);
      const href = a.href || '';
      const snip = strip(sn ? sn.innerHTML : '');
      if (title) out.push({ title, href, snip });
    });
      if (!out.length) return { ok: true, text: t('ag_no_results'), summary: t('ag_search_zero', q) };
    return {
      ok: true,
      summary: t('ag_search_ok', q, out.length),
      text: out.map((o, i) => '[' + (i + 1) + '] ' + o.title + '\n' + o.href + '\n' + o.snip).join('\n\n')
    };
  }
  if (name === 'open_url') {
    let u = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    const r = await net('GET', 'https://r.jina.ai/' + u, {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36'
    }, '');
    if (r.status < 200 || r.status >= 300) {
      return { ok: false, text: t('ag_fetch_fail', r.status), summary: t('ag_open_fail', u) };
    }
    const txt = String(r.text).replace(/\n{3,}/g, '\n\n').slice(0, 4000);
    return { ok: true, text: txt, summary: t('ag_read_ok', u) };
  }
  return { ok: false, text: t('ag_unknown_tool', name), summary: t('ag_tool_unknown_sum') };
}

/* ---------- agent prompt & parse ---------- */
function systemPrompt() {
  const cats = S.cats.map((c) => c.name).join(LANG === 'zh' ? '、' : ', ');
  if (LANG === 'zh') {
    return '你是「AragonTask」内置的通用智能体，当前日期：' + todayISO() +
      '。用户现有任务分类：' + (cats || '无') + '。\n' +
      '你的能力：问答闲聊、管理用户数据、联网检索（工具）。\n\n' +
      '【输出格式 · 重要】你的回复会以流式方式逐字显示给用户，所以：\n' +
      '1. 先直接输出给用户看的回答文本，可用 Markdown（加粗、列表、链接、代码），语言简洁温和，中文。\n' +
      '2. 若本轮需要联网检索（天气、新闻、资料、价格等外部信息），在回答文本后另起一行输出：\n' +
      '```tool\n{"name":"web_search 或 open_url","args":{"query":"..."} 或 {"url":"..."}}\n```\n' +
      '工具结果会回传给你，你再输出最终回答（最多 ' + MAX_TOOL_STEPS + ' 轮）。\n' +
      '3. 若本轮需要数据操作，在回答文本后另起一行输出（只写需要的字段）：\n' +
      '```json\n{"todos":[{"title":"...","due":"YYYY-MM-DD 或 null","category":"分类名"}],"memos":[{"title":"...","note":"...","category":"..."}],"records":[{"type":"out|in","amount":25,"title":"...","category":"餐饮/交通/购物/居家/娱乐/医疗/学习/其他","date":"YYYY-MM-DD","reimb":false}],"ops":[{"action":"complete|delete|update","target":"todo|memo|record","match":"标题关键词","to":{}}]}\n```\n' +
      '4. 普通问答不需要任何代码块。代码块是给系统执行的，用户看不到。\n' +
      '说明：category 优先复用现有分类；报销类支出 reimb 为 true；「今天/明天/下周三」等换算成具体日期；update 用 to 传要改的字段。';
  }
  return 'You are the built-in agent of "AragonTask". Today\'s date: ' + todayISO() +
    ". The user's existing task categories: " + (cats || 'none') + '.\n' +
    'Your abilities: casual Q&A, managing the user\'s data, and web search (tools).\n\n' +
    '[Output format - important] Your reply is streamed to the user character by character, so:\n' +
    '1. Output the user-facing answer text first. Markdown is fine (bold, lists, links, code). Keep it concise and warm, in English.\n' +
    '2. If this turn needs the web (weather, news, facts, prices...), output after your text, on a new line:\n' +
    '```tool\n{"name":"web_search or open_url","args":{"query":"..."} or {"url":"..."}}\n```\n' +
    'The tool result is sent back to you; then you produce the final answer (at most ' + MAX_TOOL_STEPS + ' rounds).\n' +
    '3. If this turn needs data operations, output after your text (only the fields needed):\n' +
    '```json\n{"todos":[{"title":"...","due":"YYYY-MM-DD or null","category":"category name"}],"memos":[{"title":"...","note":"...","category":"..."}],"records":[{"type":"out|in","amount":25,"title":"...","category":"food/transport/shopping/home/fun/medical/study/other","date":"YYYY-MM-DD","reimb":false}],"ops":[{"action":"complete|delete|update","target":"todo|memo|record","match":"title keyword","to":{}}]}\n```\n' +
    '4. Plain Q&A needs no code blocks. Code blocks are executed by the system and never shown to the user.\n' +
    'Notes: prefer reusing existing categories for category; reimb true for reimbursable expenses; convert "today/tomorrow/next Wednesday" into concrete dates; pass the changed fields in to for update.';
}
function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{');
  if (s < 0) return null;
  let depth = 0, end = -1;
  for (let i = s; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(t.slice(s, end + 1)); } catch (e) { return null; }
}
function resolveCat(name) {
  if (!name) return null;
  const found = S.cats.find((c) => c.name === name);
  if (found) return found.id;
  const c = { id: uid(), name: String(name).slice(0, 8), color: PALETTE[S.cats.length % PALETTE.length] };
  S.cats.push(c);
  return c.id;
}
function validISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/* ---------- agent apply ---------- */
function findByMatch(list, match) {
  if (!match) return null;
  const m = String(match).toLowerCase();
  return list.find((x) => (x.title || '').toLowerCase().indexOf(m) >= 0) || null;
}
function applyAgent(j) {
  const cards = [];
  (j.memos || []).slice(0, 8).forEach((m) => {
    const catName = String(m.category || '').slice(0, 8) || null;
    const mm = {
      id: uid(),
      title: String(m.title || t('def_memo')).slice(0, 40),
      note: String(m.note || '').slice(0, 300),
      catName,
      createdAt: Date.now()
    };
    S.memos.push(mm);
    cards.push({ kind: 'memo', title: mm.title, note: mm.note, catName });
  });
  (j.todos || []).slice(0, 8).forEach((td) => {
    const catName = String(td.category || '').slice(0, 8) || null;
    const tt = {
      id: uid(),
      title: String(td.title || t('def_todo')).slice(0, 60),
      note: '',
      catId: resolveCat(catName),
      due: validISO(td.due),
      done: false,
      createdAt: Date.now(),
      doneAt: null
    };
    S.tasks.push(tt);
    cards.push({ kind: 'todo', title: tt.title, catName, due: tt.due });
  });
  (j.records || []).slice(0, 8).forEach((r) => {
    const amount = Math.round(parseFloat(r.amount) * 100) / 100;
    if (!(amount > 0)) return;
    const isIn = r.type === 'in';
    const rc = rcatByName(r.category);
    const rr = {
      id: uid(),
      type: isIn ? 'in' : 'out',
      amount,
        title: String(r.title || (isIn ? t('def_income') : (rc ? rcatName(rc.k) : t('def_expense')))).slice(0, 30),
      cat: isIn ? null : (rc ? rc.k : 'other'),
      note: '',
      date: validISO(r.date) || todayISO(),
      reimb: (!isIn && r.reimb) ? 'pending' : 'none',
      createdAt: Date.now()
    };
    S.records.push(rr);
      cards.push({ kind: 'rec', title: rr.title, catName: isIn ? t('rt_in') : (rc ? rcatName(rc.k) : t('rc_other')), amount: rr.amount, isIn });
  });
  (j.ops || []).slice(0, 8).forEach((op) => {
    const action = op.action, target = op.target;
    let label = '';
    if (target === 'todo') {
      const tk = findByMatch(S.tasks.filter((x) => !x.done), op.match) || findByMatch(S.tasks, op.match);
      if (tk) {
        if (action === 'complete') { tk.done = true; tk.doneAt = Date.now(); label = t('op_complete', tk.title); }
        else if (action === 'delete') {
          S.tasks = S.tasks.filter((x) => x.id !== tk.id);
          label = t('op_todo_del', tk.title);
        } else if (action === 'update') {
          const to = op.to || {};
          if (to.title) tk.title = String(to.title).slice(0, 60);
          if (to.note !== undefined) tk.note = String(to.note || '').slice(0, 200);
          if (to.due !== undefined) tk.due = validISO(to.due);
          if (to.category) tk.catId = resolveCat(String(to.category).slice(0, 8));
          label = t('op_todo_upd', tk.title);
        }
      } else label = t('op_todo_404');
    } else if (target === 'memo') {
      const m = findByMatch(S.memos, op.match);
      if (m) {
        if (action === 'delete') {
          S.memos = S.memos.filter((x) => x.id !== m.id);
          label = t('op_memo_del', m.title);
        } else if (action === 'update') {
          const to = op.to || {};
          if (to.title) m.title = String(to.title).slice(0, 40);
          if (to.note !== undefined) m.note = String(to.note || '').slice(0, 300);
          if (to.category !== undefined) m.catName = String(to.category || '').slice(0, 8) || null;
          label = t('op_memo_upd', m.title);
        } else label = t('op_memo_unsupported');
      } else label = t('op_memo_404');
    } else if (target === 'record') {
      const r0 = findByMatch(S.records, op.match);
      if (r0) {
        if (action === 'delete') {
          S.records = S.records.filter((x) => x.id !== r0.id);
          label = t('op_rec_del', r0.title);
        } else if (action === 'update') {
          const to = op.to || {};
          if (to.amount !== undefined && parseFloat(to.amount) > 0) r0.amount = Math.round(parseFloat(to.amount) * 100) / 100;
          if (to.title) r0.title = String(to.title).slice(0, 30);
          if (to.reimb !== undefined) r0.reimb = to.reimb ? 'pending' : 'none';
          const rc = rcatByName(to.category);
          if (rc) r0.cat = rc.k;
          label = t('op_rec_upd', r0.title);
        } else label = t('op_rec_unsupported');
      } else label = t('op_rec_404');
    }
    cards.push({ kind: 'op', label: label || t('card_done') });
  });
  return cards;
}

/* ---------- chat rendering ---------- */
function cardHTML(c) {
  const color = memoColor(c.catName);
  const tag = c.catName ? '<span class="cm-tag">' + esc(c.catName) + '</span>' : '';
  if (c.kind === 'memo') {
    return '<div class="card-m"><div class="cm-h"><i class="mdot" style="background:' + color + '"></i><b>' + esc(c.title) + '</b>' + tag + '</div>' +
      (c.note ? '<p>' + esc(c.note) + '</p>' : '') +
      '<span class="cm-kind">' + esc(t('card_memo')) + '</span></div>';
  }
  if (c.kind === 'todo') {
    return '<div class="card-m todo-c"><div class="cm-h"><i class="mdot" style="background:' + color + '"></i><b>' + esc(c.title) + '</b>' + tag + '</div>' +
      (c.due ? '<p>' + esc(t('card_due', dueLabel(c.due))) + '</p>' : '') +
      '<span class="cm-kind">' + esc(t('card_todo')) + '</span></div>';
  }
  if (c.kind === 'rec') {
    return '<div class="card-m rec-c' + (c.isIn ? ' in-c' : '') + '"><div class="cm-h"><i class="mdot" style="background:' + (c.isIn ? GREEN : '#C5A463') + '"></i><b>' + esc(c.title) + '</b>' + tag +
      '<span class="cm-amt ' + (c.isIn ? 'in' : 'out') + '">' + (c.isIn ? '+' : '-') + fmtAmt(c.amount) + '</span></div>' +
      '<span class="cm-kind">' + esc(t('card_rec')) + '</span></div>';
  }
  if (c.kind === 'tool') {
    return '<div class="card-m tool-c"><div class="cm-h"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="#7D93A8" stroke-width="1.5"/><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" stroke="#7D93A8" stroke-width="1.5" stroke-linecap="round"/></svg><b style="font-weight:600;color:#5C6E80">' + esc(c.title) + '</b></div>' +
      '<span class="cm-kind" style="margin-top:4px">' + esc(t('card_tool')) + '</span></div>';
  }
  return '<div class="card-m todo-c"><div class="cm-h"><svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="#7C9885" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><b style="font-weight:600">' + esc(c.label || t('card_done')) + '</b></div></div>';
}
function onboardHTML() {
  return '<div class="onboard">' +
    '<div class="ob-t"><svg viewBox="0 0 24 24"><g stroke="#CC785C" stroke-width="2.1" stroke-linecap="round" fill="none"><line x1="12" y1="2.6" x2="12" y2="21.4"/><line x1="2.6" y1="12" x2="21.4" y2="12"/><line x1="5.4" y1="5.4" x2="18.6" y2="18.6"/><line x1="18.6" y1="5.4" x2="5.4" y2="18.6"/></g></svg>' + esc(t('ag_onboard_t')) + '</div>' +
    '<p>' + esc(t('ag_onboard_p')) + '</p>' +
    '<button class="mini-btn" data-act="aicfg" style="align-self:flex-start">' + esc(t('ag_onboard_cta')) + '</button></div>';
}
function renderChat() {
  const el = $('#chat');
  let h = '';
  if (!defProfile()) h += onboardHTML();
  if (!S.chat.length && defProfile()) {
    h += '<div class="msg-a">' + esc(t('ag_hello')) + '</div>';
  }
  S.chat.slice(-80).forEach((m) => {
    if (m.role === 'user') {
      h += '<div class="msg-u">' + esc(m.text) + '</div>';
    } else {
      h += '<div class="msg-a"><div class="md"' + (m.streaming ? ' id="md-live"' : '') + '>' + mdToHtml(m.text) +
        (m.streaming ? '<span class="cur"></span>' : '') + '</div>' +
        (m.cards || []).map(cardHTML).join('') + '</div>';
    }
  });
  if (chatBusy) h += '<div class="msg-a"><span class="typing"><i></i><i></i><i></i></span></div>';
  el.innerHTML = h;
  const sc = $('.chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}

/* ---------- agent turn (streaming + multi-step tool loop) ---------- */
/* Anti-flicker: during streaming we never rebuild the whole chat DOM.
   Only the last bubble's .md node is patched, at most once per frame (rAF). */
let streamRaf = 0;
let streamMsg = null;
function patchStream() {
  if (streamRaf) return;
  streamRaf = requestAnimationFrame(() => {
    streamRaf = 0;
    if (!streamMsg) return;
    const mdEl = document.querySelector('#chat #md-live');
    if (!mdEl) return;
    mdEl.innerHTML = mdToHtml(streamMsg.text) + '<span class="cur"></span>';
    const sc = document.querySelector('.chat-scroll');
    if (sc) {
      const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160;
      if (nearBottom) sc.scrollTop = sc.scrollHeight;
    }
  });
}
function streamVisible(raw) {
  const i = raw.indexOf('```');
  return (i >= 0 ? raw.slice(0, i) : raw).trim();
}
function parseAgentOutput(raw) {
  const fences = [];
  const re = /```(?:json|tool)?[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const body = m[1].trim();
    if (!body) continue;
    const j = tryParse(body);
    if (j) fences.push(j);
  }
  const textBefore = streamVisible(raw);
  for (let k = 0; k < fences.length; k++) {
    const j = fences[k];
    const t = (j && j.tool && j.tool.name) ? j.tool
      : (j && j.name && (j.args || j.url)) ? j : null;
    if (t) return { reply: textBefore, tool: t };
  }
  for (let k = 0; k < fences.length; k++) {
    const j = fences[k];
    if (j && (j.todos || j.memos || j.records || j.ops || j.reply !== undefined)) {
      const reply = textBefore || (typeof j.reply === 'string' ? j.reply : '') || '';
      return { reply, actions: j };
    }
  }
  const whole = extractJSON(raw);
  if (whole) {
    if (whole.tool && whole.tool.name) return { reply: whole.reply || '', tool: whole.tool };
    return { reply: whole.reply || textBefore, actions: whole };
  }
  return { reply: raw.trim() };
}
async function agentTurn(userText) {
  const p = defProfile();
  if (!p) {
    S.chat.push({ role: 'ai', text: t('ag_no_profile'), ts: Date.now(), cards: [] });
    persist();
    renderChat();
    return;
  }
  const history = S.chat.slice(-10).map((m) => ({
    role: m.role === 'ai' ? 'assistant' : 'user',
    content: String(m.text || '')
  }));
  const messages = history.concat([{ role: 'user', content: userText }]);

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const msg = { role: 'ai', text: '', ts: Date.now(), cards: [], streaming: true };
    S.chat.push(msg);
    streamMsg = msg;
    renderChat();
    let raw = '';
    try {
      await streamLLM(p, systemPrompt(), messages, (piece) => {
        raw += piece;
        msg.text = streamVisible(raw);
        patchStream();
      });
    } catch (e) {
      streamMsg = null;
      msg.streaming = false;
      msg.text = t('ag_err', e.message);
      persist();
      renderChat();
      return;
    }
    streamMsg = null;
    msg.streaming = false;
    const parsed = parseAgentOutput(raw);

    if (parsed.tool) {
      msg.text = parsed.reply || msg.text;
      const q = (parsed.tool.args || {}).query || (parsed.tool.args || {}).url || parsed.tool.name;
      msg.cards.push({ kind: 'tool', title: t('ag_searching', q) });
      persist();
      renderChat();
      const result = await runTool(parsed.tool);
      msg.cards = msg.cards.map((c) => (c.kind === 'tool' ? { kind: 'tool', title: result.summary } : c));
      persist();
      renderChat();
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: t('ag_tool_result', parsed.tool.name, result.text.slice(0, 6000))
      });
      continue;
    }

    msg.text = parsed.reply || t('ag_empty_resp');
    if (parsed.actions) {
      msg.cards = msg.cards.concat(applyAgent(parsed.actions));
    }
    persist();
    renderChat();
    renderAll();
    return;
  }
  S.chat.push({ role: 'ai', text: t('ag_too_many'), ts: Date.now(), cards: [] });
  persist();
  renderChat();
}
async function sendChat() {
  const inp = $('#chat-in');
  const v = inp.value.trim();
  if (!v || chatBusy) return;
  inp.value = '';
  inp.style.height = 'auto';
  S.chat.push({ role: 'user', text: v, ts: Date.now() });
  persist();
  chatBusy = true;
  refreshSend();
  renderChat();
  await agentTurn(v);
  chatBusy = false;
  persist();
  renderChat();
  renderAll();
  refreshSend();
}

/* ---------- memo view ---------- */
const mmSheet = $('#mm-sheet');
function renderMemoView() {
  const groups = {};
  S.memos.slice().sort((a, b) => b.createdAt - a.createdAt).forEach((m) => {
    const g = m.catName || t('uncat');
    (groups[g] = groups[g] || []).push(m);
  });
  let h = '';
  Object.keys(groups).forEach((g) => {
    h += '<div class="memo-g"><div class="m-dh"><b><i class="mdot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + memoColor(g) + ';margin-right:7px;vertical-align:1px"></i>' + esc(g) + '</b>' +
      '<span class="m-dsum">' + esc(t('memo_cnt', groups[g].length)) + '</span></div><div class="list card">';
    groups[g].forEach((m) => {
      const d = new Date(m.createdAt);
      const ds = fmtMD(d);
      h += '<div class="row m-row" data-mid="' + m.id + '">' +
        '<div class="rmain"><div class="ttl" style="font-size:14.5px">' + esc(m.title) + '</div>' +
        '<div class="meta">' + (m.note ? esc(m.note) + '<span class="sep">·</span>' : '') + ds + '</div>' +
        '</div>' +
        '<button class="x-b" data-act="mdel" data-id="' + m.id + '" aria-label="' + esc(t('del')) + '"><svg viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>' +
        '</div>';
    });
    h += '</div></div>';
  });
  $('#memo-view-list').innerHTML = h ||
    '<div class="empty"><h3>' + esc(t('memo_empty_t')) + '</h3><p>' + esc(t('memo_empty_p')) + '</p></div>';
}
function openMMSheet() {
  $('#mm-title').value = '';
  $('#mm-note').value = '';
  $('#mm-cat').value = '';
  $('#mm-save').disabled = true;
  openSheet(mmSheet);
  setTimeout(() => $('#mm-title').focus(), 380);
}
function saveMM() {
  const title = $('#mm-title').value.trim();
  if (!title) return;
  S.memos.push({
    id: uid(),
    title,
    note: $('#mm-note').value.trim().slice(0, 300),
    catName: $('#mm-cat').value.trim().slice(0, 8) || null,
    createdAt: Date.now()
  });
  persist();
  renderAll();
  toast(t('toast_mm_save'));
  closeSheets();
}
function deleteMemo(id) {
  const i = S.memos.findIndex((m) => m.id === id);
  if (i < 0) return;
  const removed = S.memos[i];
  S.memos.splice(i, 1);
  persist();
  renderAll();
  toast(t('toast_mm_del'), () => {
    S.memos.push(removed);
    persist();
    renderAll();
  });
}

/* ---------- AI config sheet ---------- */
const aiSheet = $('#ai-sheet');
let edAI = null;
let aiStyle = 'openai';
let aiModelList = [];

function openAISheet(p) {
  edAI = p || null;
  aiStyle = p ? p.style : 'openai';
  aiModelList = [];
  $('#ai-lb').textContent = p ? t('ai_edit_lb') : t('ai_new');
  $('#ai-name').value = p ? p.name : '';
  $('#ai-url').value = p ? p.baseUrl : AISTYLES[aiStyle].url;
  $('#ai-key').value = p ? p.apiKey : '';
  $('#ai-model').value = p ? p.model : '';
  $('#ai-headers').value = p ? (p.extraHeaders || '') : '';
  $('#ai-save').textContent = p ? t('ai_save_edit') : t('ai_save_new');
  $('#ai-save').disabled = true;
  $('#ai-def').hidden = !p || S.ai.def === p.id;
  $('#ai-del').hidden = !p;
  renderAIStyle();
  renderAIList();
  renderAIModels();
  openSheet(aiSheet);
}
function renderAIStyle() {
  document.querySelectorAll('#ai-style .ts-b').forEach((b) => {
    b.classList.toggle('on', b.dataset.id === aiStyle);
  });
}
function renderAIList() {
  const rows = S.ai.profiles.map((p) =>
    '<div class="cat-row" data-act="aiedit" data-id="' + p.id + '">' +
    '<i class="ai-row-dot' + (S.ai.def === p.id ? ' on' : '') + '"></i>' +
    '<span>' + esc(p.name) + '</span>' +
    '<span class="ai-badge">' + esc(aiStyleName(p.style)) + '</span>' +
    '<span class="cm">' + esc(p.model) + '</span>' +
    '</div>').join('');
  $('#ai-list').innerHTML = rows || '<div class="cat-row" style="color:var(--mut)">' + esc(t('ai_list_empty')) + '</div>';
}
function renderAIModels() {
  if (!aiModelList.length) { $('#ai-models').innerHTML = ''; return; }
  const cur = $('#ai-model').value.trim();
  $('#ai-models').innerHTML = aiModelList.map((m) =>
    '<button class="chip s' + (cur === m ? ' sel' : '') + '" data-act="aimodel" data-id="' + esc(m) + '">' + esc(m) + '</button>').join('');
}
function refreshAISave() {
  const ok = $('#ai-name').value.trim() && $('#ai-url').value.trim() && $('#ai-model').value.trim();
  $('#ai-save').disabled = !ok;
}
async function doFetchModels() {
  const p = {
    style: aiStyle,
    baseUrl: $('#ai-url').value.trim(),
    apiKey: $('#ai-key').value.trim(),
    extraHeaders: $('#ai-headers').value.trim() || ''
  };
  if (!p.baseUrl) { toast(t('ai_need_url')); return; }
  toast(t('ai_fetching'));
  try {
    aiModelList = await fetchModels(p);
    if (!aiModelList.length) toast(t('ai_fetch_empty'));
    else toast(t('ai_fetch_ok', aiModelList.length));
  } catch (e) {
    aiModelList = [];
    toast(t('ai_fetch_fail', e.message));
  }
  renderAIModels();
}
function saveAI() {
  const name = $('#ai-name').value.trim();
  const baseUrl = $('#ai-url').value.trim();
  const model = $('#ai-model').value.trim();
  if (!name || !baseUrl || !model) return;
  const data = {
    name, baseUrl, model,
    style: aiStyle,
    apiKey: $('#ai-key').value.trim(),
    extraHeaders: $('#ai-headers').value.trim()
  };
  if (edAI) {
    Object.assign(edAI, data);
  } else {
    const p = Object.assign({ id: uid() }, data);
    S.ai.profiles.push(p);
    if (!S.ai.def) S.ai.def = p.id;
  }
  persist();
  renderChat();
  openAISheet(edAI);
  toast(t('ai_saved'));
}

/* ---------- category sheet (todo) ---------- */
const catSheet = $('#cat-sheet');
let editingCat = null;
let selColor = PALETTE[0];

function openCatSheet() {
  editingCat = null;
  selColor = PALETTE[0];
  $('#cs-name').value = '';
  $('#cs-lb').textContent = t('cs_new');
  $('#cs-save').textContent = t('cs_add');
  $('#cs-save').disabled = true;
  $('#cs-del').hidden = true;
  renderCatList();
  renderSwatches();
  openSheet(catSheet);
}
function renderCatList() {
  const pend = S.tasks.filter((t) => !t.done);
  $('#cs-list').innerHTML = S.cats.map((c) => {
    const n = pend.filter((t) => t.catId === c.id).length;
    return '<div class="cat-row">' +
      '<i class="dot" style="background:' + c.color + '"></i>' +
      '<span>' + esc(c.name) + '</span>' +
      '<span class="ccnt">' + esc(t('cs_n_todo', n)) + '</span>' +
      '<button class="ced" data-act="ce" data-id="' + c.id + '">' + esc(t('edit')) + '</button>' +
      '</div>';
  }).join('') || '<div class="cat-row" style="color:var(--mut)">' + esc(t('cs_empty')) + '</div>';
}
function renderSwatches() {
  $('#cs-swatches').innerHTML = PALETTE.map((c) =>
    '<button class="sw' + (selColor === c ? ' sel' : '') + '" style="background:' + c + '" data-act="sw" data-id="' + c + '" aria-label="' + c + '"></button>').join('');
}
function saveCat() {
  const name = $('#cs-name').value.trim();
  if (!name) return;
  if (editingCat) {
    editingCat.name = name;
    editingCat.color = selColor;
  } else {
    const c = { id: uid(), name, color: selColor };
    S.cats.push(c);
    F.cat = c.id;
  }
  persist();
  renderAll();
  openCatSheet();
}
function deleteCat() {
  if (!editingCat) return;
  const id = editingCat.id;
  const moved = S.tasks.filter((t) => t.catId === id).length;
  S.tasks.forEach((t) => { if (t.catId === id) t.catId = null; });
  S.cats = S.cats.filter((c) => c.id !== id);
  if (F.cat === id) F.cat = 'all';
  persist();
  renderAll();
  openCatSheet();
  toast(moved ? t('toast_cat_del_moved', moved) : t('toast_cat_del'));
}

/* ---------- sheets common ---------- */
function openSheet(el) {
  $('#scrim').classList.add('on');
  el.classList.add('on');
  el.setAttribute('aria-hidden', 'false');
}
function closeSheets() {
  $('#scrim').classList.remove('on');
  document.querySelectorAll('.sheet.on').forEach((el) => {
    el.classList.remove('on');
    el.setAttribute('aria-hidden', 'true');
  });
  if (document.activeElement) document.activeElement.blur();
}

/* ---------- settings ---------- */
function renderSetLang() {
  document.querySelectorAll('#set-langs .chip').forEach((b) => {
    b.classList.toggle('sel', b.dataset.id === LANG);
  });
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  switch (act) {
    case 'view':
      if (id === 'agent2') { openAISheet(null); }
      else setView(id);
      break;
    case 'home': setView('hub'); break;
    case 'filter': F.cat = id || 'all'; expandedId = null; renderAll(); break;
    case 'manage': openCatSheet(); break;
    case 'toggle': {
      const tk = S.tasks.find((x) => x.id === id);
      if (!tk) return;
      tk.done = !tk.done;
      tk.doneAt = tk.done ? Date.now() : null;
      if (tk.repeat && tk.due) {
        const nextDue = nextDueISO(tk.due, tk.repeat);
        if (tk.done) {
          /* generate next occurrence, but never duplicate one that exists
             (e.g. the task was completed, undone, then completed again) */
          const exists = S.tasks.some((x) =>
            x.id !== tk.id && !x.done && x.title === tk.title &&
            x.repeat === tk.repeat && x.due === nextDue);
          if (!exists) {
            S.tasks.push({
              id: uid(), title: tk.title, note: tk.note, catId: tk.catId,
              due: nextDue, repeat: tk.repeat,
              done: false, createdAt: Date.now(), doneAt: null
            });
            toast(t('toast_rep_next', tk.title, dueLabel(nextDue)));
          }
        } else {
          /* un-completing removes the auto-generated next occurrence so
             toggling back and forth never leaves duplicates */
          const k = S.tasks.findIndex((x) =>
            !x.done && x.title === tk.title && x.repeat === tk.repeat && x.due === nextDue);
          if (k >= 0) {
            S.tasks.splice(k, 1);
            toast(t('toast_rep_undo'));
          }
        }
      }
      persist();
      renderAll();
      break;
    }
    case 'expand':
      expandedId = expandedId === id ? null : id;
      renderList();
      break;
    case 'edit': {
        const tk = S.tasks.find((x) => x.id === id);
        if (tk) openTaskSheet(tk);
      break;
    }
    case 'del': deleteTask(id); break;
    case 'sc': selCat = id || null; renderSheetCats(); break;
    case 'sd': selDue = id || null; renderSheetDates(); break;
    case 'sd-pick': {
      const inp = $('#ts-date-input');
      inp.value = selDue || todayISO();
      const onCh = () => {
        if (inp.value) { selDue = inp.value; renderSheetDates(); }
        inp.removeEventListener('change', onCh);
      };
      inp.addEventListener('change', onCh);
      try { inp.showPicker ? inp.showPicker() : inp.click(); } catch (err) { inp.click(); }
      setTimeout(() => inp.click(), 0);
      break;
    }
    case 'ce': {
      const c = S.cats.find((x) => x.id === id);
      if (!c) return;
      editingCat = c;
      selColor = c.color;
      $('#cs-name').value = c.name;
      $('#cs-lb').textContent = t('cs_edit');
      $('#cs-save').textContent = t('save');
      $('#cs-save').disabled = false;
      $('#cs-del').hidden = false;
      renderSwatches();
      break;
    }
    case 'sw': selColor = id; renderSwatches(); break;

    /* money */
    case 'mfilter': M.filter = id || 'all'; expandedRid = null; renderMoney(); break;
    case 'mreimb': M.filter = M.filter === 'reimb' ? 'all' : 'reimb'; expandedRid = null; renderMoney(); break;
    case 'mprev': shiftMonth(-1); expandedRid = null; renderMoney(); break;
    case 'mnext': shiftMonth(1); expandedRid = null; renderMoney(); break;
    case 'mexp':
      expandedRid = expandedRid === id ? null : id;
      renderMGroups();
      break;
    case 'rst': {
      const r = S.records.find((x) => x.id === id);
      if (!r) return;
      r.reimb = btn.dataset.st || 'pending';
      persist();
      renderMoney();
      renderHub();
      toast(r.reimb === 'done' ? t('toast_reimb_done', fmtAmt(r.amount)) : t('toast_reimb_set', rstatName(r.reimb)));
      break;
    }
    case 'redit': {
      const r = S.records.find((x) => x.id === id);
      if (r) openRecSheet(r);
      break;
    }
    case 'rdel': deleteRec(id); break;
    case 'rtype':
      selRType = id === 'in' ? 'in' : 'out';
      renderRType();
      break;
    case 'rc': selRCat = id; renderRCats(); break;
    case 'rd': selRDate = id; renderRDates(); break;
    case 'rd-pick': {
      const inp = $('#rs-date-input');
      inp.value = selRDate || todayISO();
      const onCh = () => {
        if (inp.value) { selRDate = inp.value; renderRDates(); }
        inp.removeEventListener('change', onCh);
      };
      inp.addEventListener('change', onCh);
      try { inp.showPicker ? inp.showPicker() : inp.click(); } catch (err) { inp.click(); }
      setTimeout(() => inp.click(), 0);
      break;
    }

    /* memo */
    case 'madd': openMMSheet(); break;
    case 'mdel': deleteMemo(id); break;

      /* settings */
      case 'setopen':
        renderSetLang();
        openSheet($('#set-sheet'));
        break;
      case 'lang':
        if (id !== LANG) {
          setLang(id);
          renderSetLang();
          renderHeader();
          renderAll();
          setView(V);
          toast(t('lang_changed'));
        }
        break;

    /* agent / AI */
    case 'aicfg': openAISheet(null); break;
    case 'aiedit': {
      const p = S.ai.profiles.find((x) => x.id === id);
      if (p) openAISheet(p);
      break;
    }
    case 'aistyle': {
      aiStyle = AISTYLES[id] ? id : 'openai';
      const urlIn = $('#ai-url');
      const cur = urlIn.value.trim();
      const isPreset = !cur || Object.keys(AISTYLES).some((k) => AISTYLES[k].url && AISTYLES[k].url === cur);
      if (isPreset) urlIn.value = AISTYLES[aiStyle].url;
      renderAIStyle();
      refreshAISave();
      break;
    }
    case 'aifetch': doFetchModels(); break;
    case 'aimodel':
      $('#ai-model').value = id;
      renderAIModels();
      refreshAISave();
      break;
    case 'clearchat':
      S.chat = [];
      persist();
      renderChat();
      toast(t('ag_cleared'));
      break;
    case 'link': {
      const u = btn.dataset.id || '';
      if (u && window.AndroidNet && AndroidNet.openUrl) {
        try { AndroidNet.openUrl(u); } catch (err) { /* ignore */ }
      } else if (u) {
        try { window.open(u, '_blank'); } catch (err) { /* ignore */ }
      }
      break;
    }
  }
});

$('#fab').addEventListener('click', () => {
  if (V === 'money') openRecSheet(null);
  else if (V === 'memo') openMMSheet();
  else if (V === 'todo') openTaskSheet(null);
});
$('#ts-save').addEventListener('click', saveTask);
$('#ts-del').addEventListener('click', () => {
  if (!editingTask) return;
  const id = editingTask.id;
  closeSheets();
  setTimeout(() => deleteTask(id), 200);
});
$('#rs-save').addEventListener('click', saveRec);
$('#rs-del').addEventListener('click', () => {
  if (!editingRec) return;
  const id = editingRec.id;
  closeSheets();
  setTimeout(() => deleteRec(id), 200);
});
$('#mm-save').addEventListener('click', saveMM);
$('#mm-title').addEventListener('input', () => { $('#mm-save').disabled = !$('#mm-title').value.trim(); });
$('#cs-save').addEventListener('click', saveCat);
$('#cs-del').addEventListener('click', deleteCat);
$('#scrim').addEventListener('click', closeSheets);
$('#done-toggle').addEventListener('click', () => { F.showDone = !F.showDone; renderList(); });
$('#toast-un').addEventListener('click', () => {
  if (undoFn) { undoFn(); undoFn = null; }
  $('#toast').classList.remove('on');
});
$('#chat-send').addEventListener('click', sendChat);
const chatIn = $('#chat-in');
function refreshSend() { $('#chat-send').disabled = !chatIn.value.trim() || chatBusy; }
chatIn.addEventListener('input', () => {
  chatIn.style.height = 'auto';
  chatIn.style.height = Math.min(chatIn.scrollHeight, 120) + 'px';
  refreshSend();
});
chatIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});

/* quick add bar (todo) */
let qaDueToday = true;
$('#qa-today').addEventListener('click', () => {
  qaDueToday = !qaDueToday;
  $('#qa-today').classList.toggle('sel', qaDueToday);
});
$('#qa-in').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const v = e.target.value.trim();
  if (!v) return;
  S.tasks.push({
    id: uid(), title: v, note: '',
    catId: F.cat !== 'all' ? F.cat : (S.cats[0] ? S.cats[0].id : null),
    due: qaDueToday ? todayISO() : null,
    done: false, createdAt: Date.now(), doneAt: null
  });
  persist();
  renderAll();
  e.target.value = '';
  toast(t('toast_task_add', v));
});

/* empty-state CTAs */
$('#empty-cta').addEventListener('click', () => openTaskSheet(null));
$('#m-empty-cta').addEventListener('click', () => openRecSheet(null));

/* API key visibility toggle */
$('#ai-eye').addEventListener('click', () => {
  const k = $('#ai-key');
  const show = k.type === 'password';
  k.type = show ? 'text' : 'password';
  $('#ai-eye').setAttribute('aria-label', show ? t('ai_hide_key') : t('ai_show_key'));
  $('#ai-eye').classList.toggle('on', show);
});
$('#ai-save').addEventListener('click', saveAI);
$('#ai-def').addEventListener('click', () => {
  if (!edAI) return;
  S.ai.def = edAI.id;
  persist();
  openAISheet(edAI);
  renderChat();
  toast(t('ai_def_ok'));
});
$('#ai-del').addEventListener('click', () => {
  if (!edAI) return;
  S.ai.profiles = S.ai.profiles.filter((x) => x.id !== edAI.id);
  if (S.ai.def === edAI.id) S.ai.def = S.ai.profiles[0] ? S.ai.profiles[0].id : null;
  edAI = null;
  persist();
  renderChat();
  openAISheet(null);
  toast(t('ai_del_ok'));
});
['#ai-name', '#ai-url', '#ai-model'].forEach((s) => {
  $(s).addEventListener('input', refreshAISave);
});

$('#ts-title').addEventListener('input', refreshSaveBtn);
$('#ts-note').addEventListener('input', refreshSaveBtn);
$('#cs-name').addEventListener('input', () => { $('#cs-save').disabled = !$('#cs-name').value.trim(); });
$('#rs-amt').addEventListener('input', (e) => {
  let v = e.target.value.replace(/[^\d.]/g, '');
  const parts = v.split('.');
  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
  if (v.indexOf('.') >= 0) v = v.slice(0, v.indexOf('.') + 3);
  e.target.value = v;
  refreshRSBtn();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target === $('#ts-title')) saveTask();
  else if (e.target === $('#rs-amt') || e.target === $('#rs-title')) saveRec();
  else if (e.target === $('#mm-title') || e.target === $('#mm-cat')) saveMM();
});

/* ---------- init ---------- */
renderHeader();
setView('hub');
setInterval(renderHeader, 60000);

/* ============ v1.6 big features: repeat / stats / budget / backup / search ============ */

/* ---- F3: repeat tasks ---- */
const REPS = [
  { v: null, l: 'r_none' },
  { v: 'daily', l: 'r_daily' },
  { v: 'weekly', l: 'r_weekly' },
  { v: 'monthly', l: 'r_monthly' }
];
function repLabel(v) {
  const r = REPS.find((x) => x.v === v);
  return r ? t(r.l) : '';
}
function renderRepeat() {
  $('#ts-repeat').innerHTML = REPS.map((r) =>
    '<button class="chip s' + (selRepeat === r.v ? ' sel' : '') + '" data-rp="' + (r.v || '') + '">' + esc(t(r.l)) + '</button>').join('');
}
function nextDueISO(due, rep) {
  const d = new Date(due + 'T00:00:00');
  if (rep === 'daily') d.setDate(d.getDate() + 1);
  else if (rep === 'weekly') d.setDate(d.getDate() + 7);
  else if (rep === 'monthly') d.setMonth(d.getMonth() + 1);
  return fmtISO(d);
}
$('#ts-repeat').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  selRepeat = b.dataset.rp || null;
  renderRepeat();
});

/* ---- F1: stats report ---- */
function openStats() {
  renderStats();
  openSheet($('#stats-sheet'));
}
$('#stats-btn').addEventListener('click', openStats);

function stMonths6() {
  const arr = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    arr.push(fmtISO(d).slice(0, 7));
  }
  return arr;
}
function renderStats() {
  const rs = monthRecords();
  const out = rs.filter((r) => r.type === 'out').reduce((a, r) => a + (r.amount || 0), 0);
  const inn = rs.filter((r) => r.type === 'in').reduce((a, r) => a + (r.amount || 0), 0);
  const bal = inn - out;
  $('#st-out').textContent = '−' + fmtAmt(out);
  $('#st-in').textContent = '+' + fmtAmt(inn);
  $('#st-bal').textContent = (bal >= 0 ? '+' : '−') + fmtAmt(Math.abs(bal));

  /* month label reflects the month actually being viewed */
  const isCurM = M.month === todayISO().slice(0, 7);
  const [sy, sm] = M.month.split('-').map(Number);
  const mLabel = isCurM ? t('st_this_month') : fmtYM(sy, sm);
  $('#st-cats').previousElementSibling.textContent = t('st_cat_share', mLabel);

  /* category bars */
  const byCat = {};
  rs.filter((r) => r.type === 'out').forEach((r) => {
    const k = r.cat || 'other';
    byCat[k] = (byCat[k] || 0) + (r.amount || 0);
  });
  const arr = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = arr.length ? arr[0][1] : 0;
  $('#st-cats').innerHTML = arr.length ? arr.map(([k, v]) => {
    const c = RCATS.find((x) => x.k === k);
    const col = c ? c.c : '#B5B0A0';
    return '<div class="st-brow"><span class="st-bl">' + esc(c ? rcatName(c.k) : t('rc_other')) + '</span>' +
      '<div class="st-btrack"><div class="st-bfill" style="width:' + Math.max(4, (v / max) * 100) + '%;background:' + col + '"></div></div>' +
      '<span class="st-bv">' + fmtAmt(v) + '</span></div>';
  }).join('') : '<div class="st-none">' + esc(t('st_no_spend')) + '</div>';

  /* 6-month trend */
  const months = stMonths6();
  const sums = months.map((m) => S.records
    .filter((r) => (r.date || '').slice(0, 7) === m && r.type === 'out')
    .reduce((a, r) => a + (r.amount || 0), 0));
  const mx = Math.max.apply(null, sums.concat([1]));
  const X = (i) => (6 + i * ((320 - 12) / 5)).toFixed(1); /* keep dots inside viewBox */
  const Y = (v) => (84 - (v / mx) * 72 + 3).toFixed(1);
  const pts = sums.map((v, i) => X(i) + ',' + Y(v)).join(' ');
  $('#st-svg').innerHTML =
    '<polyline points="' + pts + '" fill="none" stroke="#CC785C" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>' +
    sums.map((v, i) => '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3" fill="#CC785C"/>').join('');
  $('#st-months').innerHTML = months.map((m) => '<span>' + m.slice(5).replace('-', '/') + '</span>').join('');

  /* budget */
  const b = S.budget && S.budget.monthly;
  $('#bud-in').value = b || '';
  updateBudgetUI(out);
}
function updateBudgetUI(out) {
  const b = S.budget && S.budget.monthly;
  const bar = $('#bud-bar'), fill = $('#bud-fill'), tip = $('#bud-tip');
  if (!b) { bar.hidden = true; tip.textContent = t('bud_unset_tip'); return; }
  bar.hidden = false;
  const p = out / b;
  fill.style.width = Math.min(p, 1) * 100 + '%';
  fill.classList.toggle('warn', p >= 0.8 && p < 1);
  fill.classList.toggle('over', p >= 1);
  tip.textContent = p >= 1
      ? t('bud_over_tip', fmtAmt(out - b))
      : t('bud_tip', Math.round(p * 100), fmtAmt(b - out));
}
$('#bud-save').addEventListener('click', () => {
  const v = parseFloat($('#bud-in').value);
  S.budget = { monthly: v > 0 ? Math.round(v * 100) / 100 : null };
  persist();
  renderStats();
  renderMoney();
  toast(S.budget.monthly ? t('toast_bud_set', fmtAmt(S.budget.monthly)) : t('toast_bud_off'));
});

/* ---- F2: backup & restore ---- */
$('#exp-btn').addEventListener('click', async () => {
  const data = {
    app: 'AragonTask', v: 2, exportedAt: new Date().toISOString(),
    tasks: S.tasks, records: S.records, memos: S.memos, cats: S.cats, budget: S.budget
  };
  const json = JSON.stringify(data);
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(json);
      copied = true;
    }
  } catch (e) { /* clipboard unavailable on some WebViews */ }
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aragontask-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(copied ? t('toast_exp_both') : t('toast_exp_dl'));
  } catch (e) {
    toast(copied ? t('toast_exp_clip') : t('toast_exp_fail', e.message));
  }
});
/* two-step import confirm (native confirm() is unavailable in this WebView) */
let impArmed = 0;
$('#imp-btn').addEventListener('click', () => {
  const btn = $('#imp-btn');
  if (Date.now() < impArmed) {
    impArmed = 0;
    btn.textContent = t('imp_btn');
    btn.classList.remove('danger');
    $('#imp-file').click();
    return;
  }
  impArmed = Date.now() + 3000;
  btn.textContent = t('imp_confirm_btn');
  btn.classList.add('danger');
  toast(t('imp_confirm_toast'));
  setTimeout(() => {
    if (Date.now() >= impArmed) {
      impArmed = 0;
      btn.textContent = t('imp_btn');
      btn.classList.remove('danger');
    }
  }, 3100);
});
$('#imp-file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      if (j.app !== 'AragonTask' || !Array.isArray(j.tasks)) throw new Error(t('imp_invalid'));
      S.tasks = j.tasks;
      S.records = Array.isArray(j.records) ? j.records : [];
      S.memos = Array.isArray(j.memos) ? j.memos : [];
      if (Array.isArray(j.cats) && j.cats.length) S.cats = j.cats;
      S.budget = j.budget && j.budget.monthly ? j.budget : { monthly: null };
      M.month = todayISO().slice(0, 7);
      M.filter = 'all';
      expandedId = null;
      expandedRid = null;
      persist();
      renderAll();
      closeSheets();
      toast(t('toast_imp_ok', S.tasks.length, S.records.length, S.memos.length));
    } catch (err) {
      toast(t('toast_imp_fail', err.message));
    }
    e.target.value = '';
  };
  rd.readAsText(f);
});

/* ---- F4: global search ---- */
/* every sheet can be pulled back: tapping the grab handle closes it */
document.addEventListener('click', (e) => {
  if (e.target.closest('.grab')) closeSheets();
});

/* hardware back: close sheet > return to hub > exit app */
window.__back = function () {
  const open = document.querySelector('.sheet.on');
  if (open) { closeSheets(); return; }
  if (V !== 'hub') { setView('hub'); return; }
  if (window.AndroidNet && AndroidNet.exitApp) AndroidNet.exitApp();
};

$('#sr-open').addEventListener('click', () => {
  openSheet($('#search-sheet'));
  const i = $('#sr-in');
  i.value = '';
  $('#sr-res').innerHTML = '<div class="st-none">' + esc(t('sr_hint')) + '</div>';
  setTimeout(() => i.focus(), 380);
});
let srTimer = 0;
function srRender(q) {
  q = q.trim().toLowerCase();
  const box = $('#sr-res');
  if (!q) { box.innerHTML = '<div class="st-none">' + esc(t('sr_hint')) + '</div>'; return; }
  const hit = (s) => String(s || '').toLowerCase().indexOf(q) >= 0;
  const ts = S.tasks.filter((t) => hit(t.title) || hit(t.note)).slice(0, 8);
  const ms = S.memos.filter((m) => hit(m.title) || hit(m.note) || hit(m.catName)).slice(0, 8);
  const rc = S.records.filter((r) => hit(r.title) || hit(fmtAmt(r.amount))).slice(0, 8);
  let h = '';
  if (ts.length) h += '<div class="lb">' + esc(t('sr_todo')) + '</div>' + ts.map((t) =>
    '<button class="sr-item" data-srk="task" data-id="' + t.id + '"><i class="mdot" style="background:' + (t.done ? '#B5B0A0' : '#CC785C') + '"></i><span>' + esc(t.title) + '</span></button>').join('');
  if (ms.length) h += '<div class="lb">' + esc(t('sr_memo')) + '</div>' + ms.map((m) =>
    '<button class="sr-item" data-srk="memo" data-id="' + m.id + '"><i class="mdot" style="background:#D4A27F"></i><span>' + esc(m.title) + '</span></button>').join('');
  if (rc.length) h += '<div class="lb">' + esc(t('sr_rec')) + '</div>' + rc.map((r) => {
    const c = RCATS.find((x) => x.k === r.cat);
    return '<button class="sr-item" data-srk="rec" data-id="' + r.id + '"><i class="mdot" style="background:' + ((c || {}).c || '#B5B0A0') + '"></i><span>' +
      esc(r.title || t('sr_rec_default')) + '　' + (r.type === 'out' ? '−' : '+') + fmtAmt(r.amount) + '</span></button>';
  }).join('');
  box.innerHTML = h || '<div class="st-none">' + esc(t('sr_none', q)) + '</div>';
}
$('#sr-in').addEventListener('input', (e) => {
  clearTimeout(srTimer);
  srTimer = setTimeout(() => srRender(e.target.value), 120);
});
$('#sr-res').addEventListener('click', (e) => {
  const b = e.target.closest('.sr-item');
  if (!b) return;
  const id = b.dataset.id;
  closeSheets();
  if (b.dataset.srk === 'task') {
    setView('todo');
    expandedId = id;
    renderList();
    setTimeout(() => {
      const el = document.querySelector('.row[data-id="' + id + '"]');
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); }
    }, 80);
  } else if (b.dataset.srk === 'memo') {
    setView('memo');
    setTimeout(() => {
      const el = document.querySelector('[data-mid="' + id + '"]');
      if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1300); }
    }, 80);
  } else {
    setView('money');
    expandedRid = id;
    setTimeout(() => {
      const el = document.querySelector('.m-row [data-id="' + id + '"]');
      if (el) { const row = el.closest('.m-row'); row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1300); }
    }, 80);
  }
});
