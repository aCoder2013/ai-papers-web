// AI Papers viewer — daily / weekly views
// Mock data lives at ./data/papers.json (object keyed by YYYY-MM-DD).

const DATA_URL = './data/papers.json';

const state = {
  data: null,            // { 'YYYY-MM-DD': Paper[] }
  dates: [],             // sorted ascending
  weeks: [],             // [{ key, label, days: ['YYYY-MM-DD',...] }]
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindTabs();
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (e) {
    document.getElementById('loading').textContent = '数据加载失败：' + e.message;
    return;
  }
  state.dates = Object.keys(state.data).sort();
  state.weeks = groupByWeek(state.dates);

  document.getElementById('loading').remove();
  setupDailyView();
  setupWeeklyView();
}

/* ---------------- Tabs ---------------- */
function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('view-' + tab.dataset.view).classList.add('active');
    });
  });
}

/* ---------------- Daily ---------------- */
function setupDailyView() {
  const select = document.getElementById('date-select');
  // newest first in dropdown
  for (const d of [...state.dates].reverse()) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + ' (' + state.data[d].length + ' 篇)';
    select.appendChild(opt);
  }
  select.addEventListener('change', () => renderDaily(select.value));
  renderDaily(select.value);
}

function renderDaily(date) {
  const list = document.getElementById('daily-list');
  const badge = document.getElementById('daily-count');
  const papers = state.data[date] || [];
  badge.textContent = papers.length + ' 篇';
  list.innerHTML = '';
  if (!papers.length) {
    list.innerHTML = '<div class="empty">这一天没有数据</div>';
    return;
  }
  for (const p of papers) list.appendChild(renderPaperCard(p));
}

/* ---------------- Weekly ---------------- */
function setupWeeklyView() {
  const select = document.getElementById('week-select');
  // newest first
  for (const w of [...state.weeks].reverse()) {
    const opt = document.createElement('option');
    opt.value = w.key;
    opt.textContent = w.label;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => renderWeekly(select.value));
  renderWeekly(select.value);
}

function renderWeekly(weekKey) {
  const week = state.weeks.find((w) => w.key === weekKey);
  if (!week) return;

  const allPapers = week.days.flatMap((d) => state.data[d] || []);
  document.getElementById('weekly-count').textContent = allPapers.length + ' 篇';

  // summary card
  const summary = document.getElementById('weekly-summary');
  const authorSet = new Set();
  for (const p of allPapers) (p.authors || []).forEach((a) => authorSet.add(a));
  summary.innerHTML = `
    <h2>📊 本周概览（${week.label}）</h2>
    <div class="stats">
      <div class="stat-card"><div class="num">${allPapers.length}</div><div class="label">论文总数</div></div>
      <div class="stat-card"><div class="num">${week.days.length}</div><div class="label">覆盖天数</div></div>
      <div class="stat-card"><div class="num">${authorSet.size}</div><div class="label">独立作者</div></div>
      <div class="stat-card"><div class="num">${avgPerDay(allPapers.length, week.days.length)}</div><div class="label">日均篇数</div></div>
    </div>
  `;

  const list = document.getElementById('weekly-list');
  list.innerHTML = '';
  for (const day of week.days) {
    const papers = state.data[day] || [];
    if (!papers.length) continue;
    const section = document.createElement('div');
    section.className = 'day-section';
    const h = document.createElement('h3');
    h.textContent = `${day} · ${papers.length} 篇`;
    section.appendChild(h);
    for (const p of papers) section.appendChild(renderPaperCard(p));
    list.appendChild(section);
  }
}

function avgPerDay(total, days) {
  if (!days) return 0;
  return (total / days).toFixed(1);
}

/* ---------------- Paper card ---------------- */
function renderPaperCard(p) {
  const card = document.createElement('article');
  card.className = 'paper-card';

  const title = document.createElement('h3');
  title.className = 'paper-title';
  const titleLink = document.createElement('a');
  titleLink.href = p.abs_url || ('https://arxiv.org/abs/' + (p.arxiv_id || ''));
  titleLink.target = '_blank';
  titleLink.rel = 'noopener';
  titleLink.textContent = p.title || '(无标题)';
  title.appendChild(titleLink);
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'paper-meta';
  if (p.arxiv_id) {
    const aid = document.createElement('span');
    aid.className = 'arxiv-id';
    aid.textContent = 'arXiv:' + p.arxiv_id;
    meta.appendChild(aid);
  }
  if (p.published) {
    const dt = document.createElement('span');
    dt.className = 'date-tag';
    dt.textContent = p.published.slice(0, 10);
    meta.appendChild(dt);
  }
  if (p.primary_category) {
    const cat = document.createElement('span');
    cat.className = 'date-tag';
    cat.textContent = p.primary_category;
    meta.appendChild(cat);
  }
  card.appendChild(meta);

  if (p.authors && p.authors.length) {
    const authors = document.createElement('div');
    authors.className = 'paper-authors';
    const shown = p.authors.slice(0, 6).join(', ');
    authors.textContent = '👥 ' + shown + (p.authors.length > 6 ? `，等 ${p.authors.length} 人` : '');
    card.appendChild(authors);
  }

  if (p.abstract_text) {
    const abs = document.createElement('p');
    abs.className = 'paper-abstract collapsed';
    abs.textContent = p.abstract_text;
    card.appendChild(abs);

    const toggle = document.createElement('button');
    toggle.className = 'toggle-abstract';
    toggle.textContent = '展开摘要';
    toggle.addEventListener('click', () => {
      const collapsed = abs.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '展开摘要' : '收起摘要';
    });
    card.appendChild(toggle);
  }

  const links = document.createElement('div');
  links.className = 'paper-links';
  if (p.abs_url) links.appendChild(makeLink('📄 摘要页', p.abs_url));
  if (p.pdf_url) links.appendChild(makeLink('⬇ PDF', p.pdf_url));
  card.appendChild(links);

  return card;
}

function makeLink(text, href) {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

/* ---------------- Week grouping (ISO-style, Mon→Sun) ---------------- */
function groupByWeek(dates) {
  const map = new Map();
  for (const d of dates) {
    const dt = new Date(d + 'T00:00:00Z');
    const monday = new Date(dt);
    const dow = (dt.getUTCDay() + 6) % 7; // 0 = Mon
    monday.setUTCDate(dt.getUTCDate() - dow);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const key = fmt(monday);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: `${fmt(monday)} ~ ${fmt(sunday)}`,
        days: [],
      });
    }
    map.get(key).days.push(d);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}
