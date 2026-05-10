// AI Papers viewer — daily / weekly views, bilingual (EN + optional zh overlay)
// Main data: ./data/papers.json  { 'YYYY-MM-DD': Paper[] }
// Chinese overlay: ./data/papers.zh.json  { 'YYYY-MM-DD': { 'arxiv_id': { title_zh, gist_zh, abstract_zh } } }

const DATA_URL = './data/papers.json';
const ZH_URL = './data/papers.zh.json';

const state = {
  data: null,
  zh: null,
  dates: [],
  weeks: [],
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindTabs();
  try {
    const [dataRes, zhRes] = await Promise.all([
      fetch(DATA_URL),
      fetch(ZH_URL),
    ]);
    if (!dataRes.ok) throw new Error('papers.json HTTP ' + dataRes.status);
    state.data = await dataRes.json();
    if (zhRes.ok) {
      state.zh = await zhRes.json();
    } else {
      state.zh = {};
    }
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

function zhFor(date, arxivId) {
  if (!state.zh || !arxivId) return null;
  const byDay = state.zh[date];
  if (!byDay || typeof byDay !== 'object') return null;
  return byDay[arxivId] || null;
}

/** English one-sentence / lead for at-a-glance when zh missing */
function englishGist(abstract) {
  if (!abstract || typeof abstract !== 'string') return '';
  const t = abstract.trim();
  if (!t) return '';
  const cut = t.split(/(?<=[.!?])\s+/)[0] || t.split('\n')[0] || t;
  const max = 320;
  return cut.length > max ? cut.slice(0, max).trim() + '…' : cut;
}

function mergePaper(date, p) {
  const z = zhFor(date, p.arxiv_id);
  const gistEn = englishGist(p.abstract_text);
  return {
    ...p,
    _date: date,
    _gist_en: gistEn,
    title_zh: z?.title_zh || '',
    gist_zh: z?.gist_zh || '',
    abstract_zh: z?.abstract_zh || '',
  };
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
  for (const p of papers) list.appendChild(renderPaperCard(mergePaper(date, p)));
}

/* ---------------- Weekly ---------------- */
function setupWeeklyView() {
  const select = document.getElementById('week-select');
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

  const summary = document.getElementById('weekly-summary');
  const authorSet = new Set();
  for (const p of allPapers) (p.authors || []).forEach((a) => authorSet.add(a));
  const zhDays = week.days.filter((d) => {
    const map = state.zh[d];
    if (!map || typeof map !== 'object') return false;
    return Object.keys(map).length > 0;
  }).length;
  summary.innerHTML = `
    <h2>📊 本周概览（${week.label}）</h2>
    <div class="stats">
      <div class="stat-card"><div class="num">${allPapers.length}</div><div class="label">论文总数</div></div>
      <div class="stat-card"><div class="num">${week.days.length}</div><div class="label">覆盖天数</div></div>
      <div class="stat-card"><div class="num">${authorSet.size}</div><div class="label">独立作者</div></div>
      <div class="stat-card"><div class="num">${avgPerDay(allPapers.length, week.days.length)}</div><div class="label">日均篇数</div></div>
      <div class="stat-card"><div class="num">${zhDays}</div><div class="label">含中文 overlay 的天数</div></div>
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
    for (const p of papers) section.appendChild(renderPaperCard(mergePaper(day, p)));
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

  const gistWrap = document.createElement('div');
  gistWrap.className = 'paper-gist-block';

  if (p.gist_zh) {
    const g = document.createElement('p');
    g.className = 'paper-gist-zh';
    g.textContent = p.gist_zh;
    gistWrap.appendChild(g);
  } else if (p._gist_en) {
    const hint = document.createElement('span');
    hint.className = 'paper-gist-hint';
    hint.textContent = '暂无中文梗概 · 英文首句';
    gistWrap.appendChild(hint);
    const g = document.createElement('p');
    g.className = 'paper-gist-en';
    g.textContent = p._gist_en;
    gistWrap.appendChild(g);
  }
  if (gistWrap.childNodes.length) card.appendChild(gistWrap);

  const title = document.createElement('h3');
  title.className = 'paper-title';
  const titleLink = document.createElement('a');
  titleLink.href = p.abs_url || ('https://arxiv.org/abs/' + (p.arxiv_id || ''));
  titleLink.target = '_blank';
  titleLink.rel = 'noopener';
  titleLink.textContent = p.title_zh || p.title || '(无标题)';
  title.appendChild(titleLink);
  card.appendChild(title);

  if (p.title_zh && p.title && p.title !== p.title_zh) {
    const sub = document.createElement('div');
    sub.className = 'paper-title-en';
    sub.textContent = p.title;
    card.appendChild(sub);
  }

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

  if (p.abstract_zh) {
    const det = document.createElement('details');
    det.className = 'paper-details';
    const sum = document.createElement('summary');
    sum.textContent = '中文摘要';
    det.appendChild(sum);
    const absZh = document.createElement('p');
    absZh.className = 'paper-abstract-text';
    absZh.textContent = p.abstract_zh;
    det.appendChild(absZh);
    card.appendChild(det);
  }

  if (p.abstract_text) {
    const det = document.createElement('details');
    det.className = 'paper-details';
    if (!p.abstract_zh) det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = p.abstract_zh ? '英文摘要（原文）' : '摘要（原文）';
    det.appendChild(sum);
    const abs = document.createElement('p');
    abs.className = 'paper-abstract-text';
    abs.textContent = p.abstract_text;
    det.appendChild(abs);
    card.appendChild(det);
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
    const dow = (dt.getUTCDay() + 6) % 7;
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
