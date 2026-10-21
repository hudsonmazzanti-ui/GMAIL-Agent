// Reads the "Gmail Agent Dashboard" Google Sheet as CSV. No API key needed:
// the sheet only has to be shared as "Anyone with the link: Viewer".
const SHEET_ID = '1j5NDEfWrDHkOFrRSn90czZ-s3VXo5XYqwFcHdV1qBoE';

// Open the page with ?data=sample to use the CSVs in sample/ instead.
const useSample = new URLSearchParams(location.search).get('data') === 'sample';

function csvUrl(tab) {
  if (useSample) return `sample/${tab}.csv`;
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const [header = [], ...body] = rows;
  const keys = header.map(h => h.trim().toLowerCase());
  return body
    .filter(r => r.some(v => v.trim()))
    .map(r => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

async function fetchCsv(tab) {
  // A private sheet redirects to Google sign-in, which the browser reports as a network error.
  const res = await fetch(csvUrl(tab), { cache: 'no-store' }).catch(() => {
    throw new Error(`${tab}: can't reach the sheet. Is it shared as "Anyone with the link"?`);
  });
  if (!res.ok) throw new Error(`${tab}: HTTP ${res.status}`);
  const text = await res.text();
  // A private sheet answers with Google's sign-in HTML instead of CSV.
  if (/^\s*</.test(text)) throw new Error(`${tab}: sheet is not shared publicly`);
  return parseCsv(text);
}

// "2026-10-21" is a local calendar date; anything else goes through Date().
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(c => c != null && c !== false && c !== ''));
  return node;
}

function showState(container, message, isError = false) {
  container.replaceChildren(el(container.tagName === 'UL' ? 'li' : 'p', {
    className: isError ? 'state error' : 'state',
    textContent: message,
  }));
}

// ---- Usage chart -------------------------------------------------------

let usageRows = [];
let chart;

function usageSeries(mode) {
  const points = usageRows
    .map(r => ({ date: parseDate(r.date), value: parseFloat(r.percent) }))
    .filter(p => p.date && !isNaN(p.value))
    .sort((a, b) => a.date - b.date);

  if (mode === 'monthly') {
    const months = new Map();
    for (const p of points) {
      const key = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}`;
      const m = months.get(key) ?? { sum: 0, n: 0, date: p.date };
      m.sum += p.value; m.n++;
      months.set(key, m);
    }
    return [...months.values()].slice(-12).map(m => ({
      label: m.date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      value: Math.round((m.sum / m.n) * 10) / 10,
    }));
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 29);
  return points.filter(p => p.date >= cutoff).map(p => ({
    label: p.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: p.value,
  }));
}

function renderUsage(mode) {
  const state = document.getElementById('usage-state');
  const series = usageSeries(mode);
  state.hidden = series.length > 0;
  if (!series.length) {
    state.className = 'state';
    state.textContent = mode === 'daily' ? 'No usage logged in the last 30 days.' : 'No usage logged yet.';
  }

  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim();
  const muted = css.getPropertyValue('--muted').trim();
  const grid = css.getPropertyValue('--border').trim();
  const data = {
    labels: series.map(p => p.label),
    datasets: [{
      data: series.map(p => p.value),
      borderColor: accent,
      backgroundColor: accent + '22',
      fill: true,
      tension: 0.35,
      pointRadius: series.length > 20 ? 0 : 3,
      pointHoverRadius: 5,
      borderWidth: 2,
    }],
  };

  if (chart) { chart.data = data; chart.update(); return; }
  chart = new Chart(document.getElementById('usage-chart'), {
    type: 'line',
    data,
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y}%` } },
      },
      scales: {
        y: { min: 0, max: 100, ticks: { color: muted, callback: v => `${v}%` }, grid: { color: grid } },
        x: { ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
      },
    },
  });
}

document.querySelectorAll('.toggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    renderUsage(btn.dataset.mode);
  });
});

// ---- Articles ----------------------------------------------------------

function renderArticles(rows) {
  const list = document.getElementById('articles');
  const unread = rows
    .filter(r => r.title && r.read.toUpperCase() !== 'TRUE')
    .sort((a, b) => (parseDate(b.added) ?? 0) - (parseDate(a.added) ?? 0))
    .slice(0, 8);
  if (!unread.length) return showState(list, 'Nothing new worth reading.');

  list.replaceChildren(...unread.map(r => {
    const title = r.url
      ? el('a', { href: r.url, target: '_blank', rel: 'noopener', textContent: r.title })
      : el('strong', { textContent: r.title });
    const added = parseDate(r.added);
    const meta = [r.source, added && added.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })]
      .filter(Boolean).join(' · ');
    return el('li', {}, title,
      meta && el('div', { className: 'meta', textContent: meta }),
      r.why && el('p', { className: 'why', textContent: r.why }));
  }));
}

// ---- Calendar ----------------------------------------------------------

function renderCalendar(rows) {
  const box = document.getElementById('calendar');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + 8);

  const items = rows
    .map(r => ({ ...r, at: parseDate(r.when), allDay: /^\d{4}-\d{2}-\d{2}$/.test(r.when) }))
    .filter(r => r.title && r.at && r.at >= today && r.at < end)
    .sort((a, b) => a.at - b.at);
  if (!items.length) return showState(box, 'Nothing in the next 7 days.');

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayLabel = d => dayKey(d) === dayKey(today) ? 'Today'
    : dayKey(d) === dayKey(tomorrow) ? 'Tomorrow'
    : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const nodes = [];
  let lastDay = '';
  for (const r of items) {
    if (dayKey(r.at) !== lastDay) {
      lastDay = dayKey(r.at);
      nodes.push(el('div', { className: 'day', textContent: dayLabel(r.at) }));
    }
    const time = r.allDay ? 'All day' : r.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const isReminder = r.type.toLowerCase() === 'reminder';
    nodes.push(el('div', { className: 'event' },
      el('time', { dateTime: r.when, textContent: time }),
      el('div', {},
        el('span', { textContent: r.title }),
        isReminder && el('span', { className: 'tag', textContent: 'Reminder' }),
        r.details && el('div', { className: 'meta', textContent: r.details }))));
  }
  box.replaceChildren(...nodes);
}

// ---- Load --------------------------------------------------------------

async function load() {
  const [usage, articles, calendar, meta] = await Promise.allSettled(
    ['usage', 'articles', 'calendar', 'meta'].map(fetchCsv));

  if (usage.status === 'fulfilled') {
    usageRows = usage.value;
    renderUsage(document.querySelector('.toggle [aria-pressed="true"]').dataset.mode);
  } else {
    const state = document.getElementById('usage-state');
    state.className = 'state error';
    state.textContent = `Couldn't load usage (${usage.reason.message}).`;
  }

  if (articles.status === 'fulfilled') renderArticles(articles.value);
  else showState(document.getElementById('articles'), `Couldn't load articles (${articles.reason.message}).`, true);

  if (calendar.status === 'fulfilled') renderCalendar(calendar.value);
  else showState(document.getElementById('calendar'), `Couldn't load calendar (${calendar.reason.message}).`, true);

  if (meta.status === 'fulfilled') {
    const row = meta.value.find(r => r.key === 'last_updated');
    const when = row && parseDate(row.value);
    if (when) document.getElementById('updated').textContent =
      `Data as of ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
  }
}

load();
