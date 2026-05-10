// AI Papers viewer — tag-based discovery + AI review (Chinese)
// Data: ./data/papers.json  { 'YYYY-MM-DD': Paper[] }
// AI review: ./data/analysis/YYYY-MM-DD.summary.md (Chinese markdown)

const DATA_URL = './data/papers.json';

const state = {
  data: null,
  dates: [],
  tagIndex: null, // { [date]: { tags: string[], byTag: { [tag]: PaperView[] } } }
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindTabs();
  try {
    const dataRes = await fetch(DATA_URL);
    if (!dataRes.ok) throw new Error('papers.json HTTP ' + dataRes.status);
    state.data = await dataRes.json();
  } catch (e) {
    document.getElementById('loading').textContent = 'Failed to load data: ' + e.message;
    return;
  }
  state.dates = Object.keys(state.data).sort();
  state.tagIndex = buildTagIndex(state.data);

  document.getElementById('loading').remove();
  setupDiscoverView();
  setupReviewsView();
}

/** English one-sentence lead for at-a-glance */
function englishGist(abstract) {
  if (!abstract || typeof abstract !== 'string') return '';
  const t = abstract.trim();
  if (!t) return '';
  const cut = t.split(/(?<=[.!?])\s+/)[0] || t.split('\n')[0] || t;
  const max = 320;
  return cut.length > max ? cut.slice(0, max).trim() + '…' : cut;
}

function viewPaper(date, p) {
  const gistEn = englishGist(p.abstract_text || p.abstract);
  return { ...p, _date: date, _gist_en: gistEn, _tags: inferTags(p) };
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

/* ---------------- Discover (tag-based) ---------------- */
function setupDiscoverView() {
  const select = document.getElementById('date-select');
  for (const d of [...state.dates].reverse()) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + ' (' + state.data[d].length + ')';
    select.appendChild(opt);
  }
  select.addEventListener('change', () => renderDiscover(select.value, null));

  const tagSelect = document.getElementById('tag-select');
  tagSelect.addEventListener('change', () => {
    const d = select.value;
    renderDiscover(d, tagSelect.value || null);
  });

  renderDiscover(select.value, null);
}

function renderDiscover(date, tag) {
  const list = document.getElementById('discover-list');
  const badge = document.getElementById('daily-count');
  const datePapers = (state.data[date] || []).map((p) => viewPaper(date, p));
  badge.textContent = `${datePapers.length} papers`;
  list.innerHTML = '';
  if (!datePapers.length) {
    list.innerHTML = '<div class="empty">No data for this date.</div>';
    return;
  }

  const tagSelect = document.getElementById('tag-select');
  fillTagSelect(tagSelect, state.tagIndex[date]?.tags || [], tag);
  renderTagShelf(date, tag);

  if (tag && state.tagIndex[date]?.byTag?.[tag]) {
    for (const p of state.tagIndex[date].byTag[tag]) list.appendChild(renderPaperCard(p));
    return;
  }

  // default: show curated shelves
  const shelves = pickShelves(state.tagIndex[date]);
  for (const shelf of shelves) {
    list.appendChild(renderShelfSection(shelf.tag, shelf.papers));
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

  if (p._gist_en) {
    const hint = document.createElement('span');
    hint.className = 'paper-gist-hint';
    hint.textContent = 'One-sentence gist';
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
  titleLink.textContent = p.title || '(untitled)';
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
  if (p._tags && p._tags.length) {
    const t = document.createElement('span');
    t.className = 'date-tag';
    t.textContent = p._tags.slice(0, 2).join(' · ');
    meta.appendChild(t);
  }
  card.appendChild(meta);

  if (p.authors && p.authors.length) {
    const authors = document.createElement('div');
    authors.className = 'paper-authors';
    const shown = p.authors.slice(0, 6).join(', ');
    authors.textContent = shown + (p.authors.length > 6 ? `, +${p.authors.length - 6} more` : '');
    card.appendChild(authors);
  }

  if (p.abstract_text) {
    const det = document.createElement('details');
    det.className = 'paper-details';
    det.open = false;
    const sum = document.createElement('summary');
    sum.textContent = 'Abstract';
    det.appendChild(sum);
    const abs = document.createElement('p');
    abs.className = 'paper-abstract-text';
    abs.textContent = p.abstract_text;
    det.appendChild(abs);
    card.appendChild(det);
  }

  const links = document.createElement('div');
  links.className = 'paper-links';
  if (p.abs_url) links.appendChild(makeLink('Abstract', p.abs_url));
  if (p.pdf_url) links.appendChild(makeLink('PDF', p.pdf_url));
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

/* ---------------- Tagging ---------------- */
function inferTags(p) {
  const title = (p.title || '').toLowerCase();
  const abs = (p.abstract_text || '').toLowerCase();
  const txt = title + '\n' + abs;
  const tags = new Set();

  const add = (t) => tags.add(t);

  // Core themes
  if (txt.includes('diffusion')) add('Diffusion');
  if (txt.includes('reinforcement learning') || txt.includes('rl') || txt.includes('policy')) add('RL');
  if (txt.includes('agent') || txt.includes('tool') || txt.includes('webshop') || txt.includes('alfworld')) add('Agents');
  if (txt.includes('multimodal') || txt.includes('vision') || txt.includes('audio') || txt.includes('video')) add('Multimodal');
  if (txt.includes('benchmark') || txt.includes('dataset') || txt.includes('evaluation')) add('Benchmarks');
  if (txt.includes('mixture of experts') || txt.includes('moe') || txt.includes('experts')) add('MoE');
  if (txt.includes('safety') || txt.includes('alignment')) add('Safety');
  if (txt.includes('long-context') || txt.includes('long horizon') || txt.includes('context length')) add('Long-context');
  if (txt.includes('kernel') || txt.includes('triton') || txt.includes('gpu')) add('Systems');

  // Domains
  if (txt.includes('driving') || txt.includes('autonomous') || txt.includes('navsim')) add('Robotics');
  if (txt.includes('remote sensing') || txt.includes('geospatial')) add('Geo');
  if (txt.includes('math') || txt.includes('theorem')) add('Math');
  if (txt.includes('table') || txt.includes('tabular')) add('Tables');

  // Fallback from arXiv primary category
  if (p.primary_category && typeof p.primary_category === 'string') {
    const c = p.primary_category;
    if (c.includes('cs.CL')) add('NLP');
    if (c.includes('cs.CV')) add('CV');
    if (c.includes('cs.LG')) add('ML');
  }

  const ordered = [...tags];
  ordered.sort((a, b) => a.localeCompare(b));
  return ordered;
}

function buildTagIndex(data) {
  const out = {};
  for (const date of Object.keys(data)) {
    const byTag = {};
    const all = (data[date] || []).map((p) => viewPaper(date, p));
    for (const p of all) {
      const tags = p._tags?.length ? p._tags : ['Other'];
      for (const t of tags) {
        if (!byTag[t]) byTag[t] = [];
        byTag[t].push(p);
      }
    }
    const tags = Object.keys(byTag).sort((a, b) => byTag[b].length - byTag[a].length || a.localeCompare(b));
    out[date] = { tags, byTag };
  }
  return out;
}

function fillTagSelect(select, tags, active) {
  const prev = select.value;
  select.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'All tags';
  select.appendChild(optAll);
  for (const t of tags) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    select.appendChild(opt);
  }
  select.value = active ?? prev ?? '';
}

function renderTagShelf(date, activeTag) {
  const shelf = document.getElementById('tag-shelf');
  const tags = state.tagIndex[date]?.tags || [];
  shelf.innerHTML = '';
  for (const t of tags.slice(0, 14)) {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (activeTag === t ? ' active' : '');
    b.textContent = `${t} · ${(state.tagIndex[date].byTag[t] || []).length}`;
    b.addEventListener('click', () => {
      const sel = document.getElementById('tag-select');
      sel.value = t;
      renderDiscover(date, t);
    });
    shelf.appendChild(b);
  }
}

function pickShelves(dayIndex) {
  if (!dayIndex) return [];
  const picked = [];
  for (const t of dayIndex.tags.slice(0, 8)) {
    picked.push({ tag: t, papers: dayIndex.byTag[t].slice(0, 10) });
  }
  return picked;
}

function renderShelfSection(tag, papers) {
  const wrap = document.createElement('section');
  wrap.className = 'shelf-section';
  const h = document.createElement('div');
  h.className = 'shelf-header';
  h.innerHTML = `<h2>${tag}</h2><span class="shelf-meta">${papers.length} shown</span>`;
  wrap.appendChild(h);

  const row = document.createElement('div');
  row.className = 'shelf-row';
  for (const p of papers) row.appendChild(renderMiniCard(p));
  wrap.appendChild(row);
  return wrap;
}

function renderMiniCard(p) {
  const card = document.createElement('article');
  card.className = 'mini-card';
  const a = document.createElement('a');
  a.href = p.abs_url || ('https://arxiv.org/abs/' + (p.arxiv_id || ''));
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = p.title || '(untitled)';
  a.className = 'mini-title';
  card.appendChild(a);
  const m = document.createElement('div');
  m.className = 'mini-meta';
  m.textContent = `${p.arxiv_id || ''}`.trim();
  card.appendChild(m);
  return card;
}

/* ---------------- AI Review (Chinese markdown) ---------------- */
function setupReviewsView() {
  const select = document.getElementById('review-date-select');
  for (const d of [...state.dates].reverse()) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => renderReview(select.value));
  renderReview(select.value);
}

async function renderReview(date) {
  const panel = document.getElementById('review-panel');
  const badge = document.getElementById('review-status');
  badge.textContent = 'Loading…';
  panel.innerHTML = '';
  const url = `./data/analysis/${date}.summary.md`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const md = await res.text();
    badge.textContent = 'Chinese review';
    panel.appendChild(renderMarkdownAsPlain(md));
  } catch (e) {
    badge.textContent = 'No review';
    panel.innerHTML = `<div class="empty">No AI review for ${date}. Expected: <code>${url}</code></div>`;
  }
}

function renderMarkdownAsPlain(md) {
  // Minimal safe rendering: headings + lists + paragraphs, no HTML injection.
  const root = document.createElement('div');
  root.className = 'md';
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      const level = Math.min(6, line.match(/^#+/)[0].length);
      const h = document.createElement('h' + level);
      h.textContent = line.replace(/^#{1,6}\s+/, '').trim();
      root.appendChild(h);
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      let ul = root.lastElementChild && root.lastElementChild.tagName === 'UL' ? root.lastElementChild : null;
      if (!ul) {
        ul = document.createElement('ul');
        root.appendChild(ul);
      }
      const li = document.createElement('li');
      li.textContent = line.replace(/^\s*-\s+/, '').trim();
      ul.appendChild(li);
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    const p = document.createElement('p');
    p.textContent = t;
    root.appendChild(p);
  }
  return root;
}
