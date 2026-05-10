// 面向中文用户的书架式 AI 论文浏览器。
// Data: ./data/papers.json
// 当日总览 AI 点评: ./data/analysis/YYYY-MM-DD.summary.md
// 单篇点评（可选）: ./data/reviews/YYYY-MM-DD.json → reviews[stablePaperId]，由 scripts/generate-paper-reviews.mjs export/merge 生成（无第三方 API）
// 背景层：library-scene.js 会尝试挂上 window.libraryAtmosphere；若你大幅改动布局需同步 WebGL 尺寸，可调用 libraryAtmosphere?.resize()（默认已监听 window resize）。

const DATA_URL = './data/papers.json';

function normalizeArxivId(id) {
  return String(id || '')
    .trim()
    .replace(/^arxiv:/i, '')
    .replace(/\.pdf$/i, '');
}

function extractArxivFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i);
  return m ? normalizeArxivId(m[1]) : '';
}

function hashTitleKey(title) {
  const s = String(title || '').trim();
  if (!s) return '';
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return `title:${h.toString(16)}`;
}

/** 与 scripts/generate-paper-reviews.mjs 中 stablePaperId 保持一致 */
function stablePaperId(paper) {
  const raw = normalizeArxivId(paper.arxiv_id);
  if (raw) return raw;
  const u = extractArxivFromUrl(paper.abs_url) || extractArxivFromUrl(paper.pdf_url);
  if (u) return u;
  return hashTitleKey(paper.title);
}
const TAG_LABELS = {
  Agents: '智能体',
  Benchmarks: '评测/基准',
  Diffusion: '扩散模型',
  RL: '强化学习',
  Multimodal: '多模态',
  'Long-context': '长上下文',
  MoE: '专家模型',
  Safety: '安全/对齐',
  Systems: '系统/工程',
  Math: '数学推理',
  Tables: '表格数据',
  Robotics: '机器人',
  Geo: '遥感/地理',
  Music: '音乐',
  Bio: '生物医学',
  NLP: '语言模型',
  CV: '视觉',
  ML: '机器学习',
  Other: '其他',
};

const state = {
  data: {},
  dates: [],
  activeDate: '',
  activeTag: '',
  activePaper: null,
  reviewByDate: {},
  reviewRawByDate: {}, // date -> full markdown string
  paperReviewsByDate: {}, // date -> { [arxiv_id]: zh text }
};

function setupExplorerChrome() {
  document.getElementById('explorer-list-btn')?.addEventListener('click', () => {
    document.documentElement.classList.toggle('explorer-list-open');
  });
  document.getElementById('explorer-list-scrim')?.addEventListener('click', () => {
    document.documentElement.classList.remove('explorer-list-open');
  });
  document.getElementById('explorer-review-btn')?.addEventListener('click', () => {
    openReviewModal(state.activeDate);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupExplorerChrome();
  setupReviewModal();
  setupPaperDrawer();
  window.addEventListener('library-atmosphere-ready', syncLibrary3D);
  window.addEventListener('library-paper-select', onLibraryPaperSelectFrom3D);
  init().catch((error) => {
    console.error(error);
    setLoading(`渲染失败：${error.message}`);
  });
});

async function init() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`papers.json HTTP ${res.status}`);
    state.data = await res.json();
  } catch (error) {
    setLoading(`数据加载失败：${error.message}`);
    return;
  }

  state.dates = Object.keys(state.data).sort();
  state.activeDate = state.dates[state.dates.length - 1] || '';

  setupControls();
  await renderDate(state.activeDate);
  document.getElementById('loading')?.remove();
}

function setLoading(message) {
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = message;
}

function setupControls() {
  const dateSelect = document.getElementById('date-select');
  const tagSelect = document.getElementById('tag-select');
  const allButton = document.getElementById('all-button');

  for (const date of [...state.dates].reverse()) {
    const option = document.createElement('option');
    option.value = date;
    option.textContent = `${date}（${getPapers(date).length} 篇）`;
    dateSelect.appendChild(option);
  }
  dateSelect.value = state.activeDate;

  dateSelect.addEventListener('change', async () => {
    state.activeDate = dateSelect.value;
    state.activeTag = '';
    state.activePaper = null;
    await renderDate(state.activeDate);
  });

  tagSelect.addEventListener('change', () => {
    state.activeTag = tagSelect.value;
    state.activePaper = null;
    renderShelves();
    renderReader(null);
  });

  allButton.addEventListener('click', () => {
    state.activeTag = '';
    tagSelect.value = '';
    state.activePaper = null;
    renderShelves();
    renderReader(null);
  });
}

async function renderDate(date) {
  const papers = getPapers(date);
  const tags = getTags(papers);
  state.activeTag = tags.includes(state.activeTag) ? state.activeTag : '';

  document.getElementById('hero-date').textContent = date || '暂无日期';
  document.getElementById('hero-count').textContent = `${papers.length} 篇论文`;
  document.getElementById('paper-count').textContent = `${papers.length} 篇`;

  fillTagSelect(tags);
  renderTagChips(tags);
  renderShelves();
  renderReader(null);
  await Promise.all([renderReview(date), loadPaperReviews(date)]);
}

function syncLibrary3D() {
  const setPapers = window.libraryAtmosphere?.setPapers;
  if (typeof setPapers !== 'function') return;
  const all = getPapers(state.activeDate);
  const visible = state.activeTag ? all.filter((p) => p._tags.includes(state.activeTag)) : all;
  setPapers(visible);
}

function onLibraryPaperSelectFrom3D(ev) {
  const paper = ev.detail?.paper;
  if (!paper) return;
  state.activePaper = paper;
  const sid = stablePaperId(paper);
  document.querySelectorAll('.book-card').forEach((c) => {
    c.classList.toggle('active', c.dataset.paperId === sid);
  });
  renderReader(paper);
  focusPaperDrawer();
}

function getPapers(date) {
  return (state.data[date] || []).map((paper) => toPaperView(date, paper));
}

function toPaperView(date, paper) {
  const abstract = paper.abstract_text || paper.abstract || '';
  const tags = inferTags(paper);
  return {
    ...paper,
    _date: date,
    _abstract: abstract,
    _gist: firstSentence(abstract),
    _tags: tags.length ? tags : ['Other'],
  };
}

function fillTagSelect(tags) {
  const select = document.getElementById('tag-select');
  select.innerHTML = '';

  const all = document.createElement('option');
  all.value = '';
  all.textContent = '全部主题';
  select.appendChild(all);

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tagLabel(tag);
    select.appendChild(option);
  }
  select.value = state.activeTag;
}

function renderTagChips(tags) {
  const shelf = document.getElementById('tag-shelf');
  shelf.innerHTML = '';
  const papers = getPapers(state.activeDate);

  for (const tag of tags.slice(0, 16)) {
    const button = document.createElement('button');
    button.className = `tag-chip${state.activeTag === tag ? ' active' : ''}`;
    button.type = 'button';
    button.textContent = `${tagLabel(tag)} ${papers.filter((p) => p._tags.includes(tag)).length}`;
    button.addEventListener('click', () => {
      state.activeTag = tag;
      document.getElementById('tag-select').value = tag;
      state.activePaper = null;
      renderTagChips(tags);
      renderShelves();
      renderReader(null);
    });
    shelf.appendChild(button);
  }
}

function renderShelves() {
  const root = document.getElementById('shelves');
  const all = getPapers(state.activeDate);
  const visible = state.activeTag ? all.filter((paper) => paper._tags.includes(state.activeTag)) : all;
  root.innerHTML = '';

  document.getElementById('shelf-title').textContent = state.activeTag
    ? `${tagLabel(state.activeTag)}主题`
    : '推荐主题';
  document.getElementById('paper-count').textContent = `${visible.length} 篇`;
  const expPill = document.getElementById('explorer-paper-pill');
  if (expPill) expPill.textContent = `${visible.length} 篇`;

  if (!visible.length) {
    root.innerHTML = '<div class="empty">这个主题下暂时没有论文。</div>';
    syncLibrary3D();
    return;
  }

  if (state.activeTag) {
    root.appendChild(renderShelf(state.activeTag, visible));
    syncLibrary3D();
    return;
  }

  const grouped = groupByTag(all);
  const shelfOrder = Object.keys(grouped)
    .sort((a, b) => grouped[b].length - grouped[a].length || a.localeCompare(b))
    .slice(0, 8);

  for (const tag of shelfOrder) {
    root.appendChild(renderShelf(tag, grouped[tag].slice(0, 12)));
  }
  syncLibrary3D();
}

function renderShelf(tag, papers) {
  const section = document.createElement('section');
  section.className = 'shelf-section';

  const header = document.createElement('div');
  header.className = 'shelf-header';

  const titleWrap = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = '主题';
  const title = document.createElement('h3');
  title.textContent = tagLabel(tag);
  titleWrap.append(eyebrow, title);

  const count = document.createElement('span');
  count.className = 'pill';
  count.textContent = `展示 ${papers.length} 篇`;
  header.append(titleWrap, count);
  section.appendChild(header);

  const row = document.createElement('div');
  row.className = 'book-row';
  for (const paper of papers) row.appendChild(renderBookCard(paper));
  section.appendChild(row);
  return section;
}

function renderBookCard(paper) {
  const button = document.createElement('button');
  button.className = 'book-card';
  button.type = 'button';
  button.dataset.paperId = stablePaperId(paper);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    state.activePaper = paper;
    document.querySelectorAll('.book-card').forEach((card) => card.classList.remove('active'));
    button.classList.add('active');
    renderReader(paper);
    focusPaperDrawer();
  });

  const cover = document.createElement('div');
  cover.className = `book-cover tone-${toneFor(paper._tags[0])}`;
  const label = document.createElement('span');
  label.textContent = tagLabel(paper._tags[0] || 'Other');
  const title = document.createElement('strong');
  title.textContent = paper.title || '(untitled)';
  cover.append(label, title);

  const gist = document.createElement('p');
  gist.className = 'book-gist';
  gist.textContent = paper._gist || '打开后可查看摘要、原文链接与 AI 中文点评。';

  const meta = document.createElement('div');
  meta.className = 'book-meta';
  meta.textContent = compactAuthors(paper.authors);

  button.append(cover, gist, meta);
  return button;
}

function renderReader(paper) {
  const reader = document.getElementById('paper-drawer-body');
  const titleEl = document.getElementById('paper-drawer-title');
  if (!reader) return;

  if (!paper) {
    closePaperDrawer();
    return;
  }

  if (titleEl) titleEl.textContent = paper.title || '（无标题）';
  reader.innerHTML = '';

  const root = document.createElement('div');
  root.className = 'detail-root';

  const header = document.createElement('header');
  header.className = 'detail-header';

  const tagsRow = document.createElement('div');
  tagsRow.className = 'detail-tags';
  for (const t of paper._tags) {
    const pill = document.createElement('span');
    pill.className = 'detail-tag-pill';
    pill.textContent = tagLabel(t);
    tagsRow.appendChild(pill);
  }
  header.appendChild(tagsRow);

  const gist = document.createElement('p');
  gist.className = 'detail-gist';
  gist.textContent = paper._gist || '暂无一句话梗概。';
  header.appendChild(gist);

  const authors = document.createElement('p');
  authors.className = 'detail-authors';
  authors.textContent = compactAuthors(paper.authors, 12);
  header.appendChild(authors);

  const actions = document.createElement('div');
  actions.className = 'detail-actions';
  if (paper.abs_url) actions.appendChild(linkButton('打开原文', paper.abs_url));
  if (paper.pdf_url) actions.appendChild(linkButton('阅读 PDF', paper.pdf_url));
  header.appendChild(actions);

  root.appendChild(header);

  const secAbs = document.createElement('section');
  secAbs.className = 'detail-section';
  secAbs.appendChild(el('h3', 'detail-section-title', '摘要'));
  const absP = document.createElement('p');
  absP.className = 'detail-abstract';
  absP.textContent = paper._abstract || '暂无摘要。';
  secAbs.appendChild(absP);
  root.appendChild(secAbs);

  const review = state.reviewByDate[paper._date];
  const secRev = document.createElement('section');
  secRev.className = 'detail-section detail-section--review';
  secRev.appendChild(el('h3', 'detail-section-title', 'AI 中文点评'));

  const pid = stablePaperId(paper);
  const map = state.paperReviewsByDate[paper._date] || {};
  const perPaper = pid && map[pid] ? String(map[pid]).trim() : '';

  const revP = document.createElement('p');
  revP.className = 'detail-review-text';
  const note = document.createElement('p');
  note.className = 'detail-review-note muted';
  if (perPaper) {
    revP.textContent = perPaper;
    note.textContent = '本篇独立生成的中文点评（键与 arXiv ID 或 URL 推导一致）。';
  } else {
    revP.textContent = review?.short || '这一天暂无 AI 总结；本篇也未收录单独点评。';
    note.textContent =
      '暂无本篇单独点评；展示的是当日左侧栏「总览摘要」节选。可用 scripts/generate-paper-reviews.mjs export / merge 写入 data/reviews（无需 API）。';
  }
  secRev.appendChild(revP);
  secRev.appendChild(note);

  root.appendChild(secRev);

  reader.appendChild(root);
  openPaperDrawer();
}

function focusPaperDrawer() {
  const panel = document.getElementById('paper-drawer-panel');
  if (!panel) return;
  try {
    panel.focus({ preventScroll: true });
  } catch {
    panel.focus();
  }
}

function linkButton(label, href) {
  const a = document.createElement('a');
  a.className = 'reader-link';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = label;
  return a;
}

async function renderReview(date) {
  const root = document.getElementById('review-highlights');
  const fullBtn = document.getElementById('review-full-btn');
  root.innerHTML = '<p class="muted">正在加载 AI 点评…</p>';
  if (fullBtn) {
    fullBtn.disabled = true;
    fullBtn.onclick = null;
  }

  const review = await loadReview(date);
  state.reviewByDate[date] = review;

  if (!review) {
    root.innerHTML = '<p class="muted">这一天暂无 AI 点评。</p>';
    if (fullBtn) {
      fullBtn.disabled = true;
      fullBtn.onclick = null;
    }
    return;
  }

  if (fullBtn) {
    fullBtn.disabled = !state.reviewRawByDate[date];
    fullBtn.onclick = () => openReviewModal(date);
  }

  root.innerHTML = '';
  const summary = document.createElement('p');
  summary.className = 'review-lead';
  summary.textContent = review.short;
  root.appendChild(summary);

  const list = document.createElement('ul');
  for (const item of review.highlights.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  root.appendChild(list);
}

function setupReviewModal() {
  const modal = document.getElementById('review-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => closeReviewModal());
  });
}

function setupPaperDrawer() {
  const drawer = document.getElementById('paper-drawer');
  if (!drawer) return;

  drawer.querySelectorAll('[data-close-paper-drawer]').forEach((el) => {
    el.addEventListener('click', () => closePaperDrawer());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('review-modal');
    if (modal && !modal.hidden) {
      closeReviewModal();
      return;
    }
    if (document.documentElement.classList.contains('explorer-list-open')) {
      document.documentElement.classList.remove('explorer-list-open');
      return;
    }
    if (!drawer.hidden) closePaperDrawer();
  });
}

function openPaperDrawer() {
  const drawer = document.getElementById('paper-drawer');
  if (!drawer) return;
  clearTimeout(drawer._hideTimer);
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => drawer.classList.add('is-open'));
  });
}

function closePaperDrawer() {
  const drawer = document.getElementById('paper-drawer');
  if (!drawer) return;

  const wasOpen = drawer.classList.contains('is-open') || !drawer.hidden;
  drawer.classList.remove('is-open');
  document.body.classList.remove('drawer-open');
  state.activePaper = null;
  document.querySelectorAll('.book-card').forEach((card) => card.classList.remove('active'));
  const bodyEl = document.getElementById('paper-drawer-body');
  if (bodyEl) bodyEl.innerHTML = '';
  const titleEl = document.getElementById('paper-drawer-title');
  if (titleEl) titleEl.textContent = '论文详情';

  clearTimeout(drawer._hideTimer);
  if (!wasOpen) {
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    return;
  }

  drawer._hideTimer = setTimeout(() => {
    if (drawer.classList.contains('is-open')) return;
    drawer.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
  }, 320);
}

function openReviewModal(date) {
  const modal = document.getElementById('review-modal');
  const body = document.getElementById('review-modal-body');
  const raw = state.reviewRawByDate[date];
  if (!modal || !body) return;
  if (!raw) {
    body.innerHTML = '<p class="muted">暂无 Markdown 原文可展示。</p>';
  } else {
    body.innerHTML = '';
    body.appendChild(renderMarkdownDom(stripArxivSection(raw)));
  }
  const title = document.getElementById('review-modal-title');
  if (title) title.textContent = `当日 AI 中文点评 · ${date}`;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function closeReviewModal() {
  const modal = document.getElementById('review-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

function stripArxivSection(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^##\s+覆盖的\s+arxiv_id/i.test(line)) break;
    if (/^以下自\s+\*\*.*arxiv_id/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n');
}

/** 将 Markdown 转为 DOM（安全：不注入 HTML，仅处理标题/列表/段落与 **加粗**） */
function renderMarkdownDom(md) {
  const root = document.createElement('div');
  root.className = 'md';
  const lines = md.split(/\r?\n/);
  let i = 0;

  const flushParagraph = (buf) => {
    const text = buf.join(' ').trim();
    if (!text) return;
    const p = document.createElement('p');
    appendWithBold(p, text);
    root.appendChild(p);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const level = Math.min(6, (trimmed.match(/^#+/) || [''])[0].length);
      const h = document.createElement(`h${level}`);
      const titleText = trimmed.replace(/^#{1,6}\s+/, '');
      appendWithBold(h, titleText);
      root.appendChild(h);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const ul = document.createElement('ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const li = document.createElement('li');
        const item = lines[i].replace(/^\s*[-*]\s+/, '');
        appendWithBold(li, item);
        ul.appendChild(li);
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s+/.test(lines[i].trim()) && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    flushParagraph(para);
  }

  return root;
}

function appendWithBold(container, text) {
  const parts = String(text).split(/\*\*/);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (i % 2 === 1) {
      const s = document.createElement('strong');
      s.textContent = parts[i];
      container.appendChild(s);
    } else {
      container.appendChild(document.createTextNode(parts[i]));
    }
  }
}

async function loadPaperReviews(date) {
  const url = `./data/reviews/${date}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      delete state.paperReviewsByDate[date];
      return;
    }
    const j = await res.json();
    state.paperReviewsByDate[date] =
      j.reviews && typeof j.reviews === 'object' ? j.reviews : {};
  } catch {
    delete state.paperReviewsByDate[date];
  }
}

async function loadReview(date) {
  const url = `./data/analysis/${date}.summary.md`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      delete state.reviewRawByDate[date];
      return null;
    }
    const md = await res.text();
    state.reviewRawByDate[date] = md;
    return parseReview(md);
  } catch {
    delete state.reviewRawByDate[date];
    return null;
  }
}

function parseReview(md) {
  const lines = md.split(/\r?\n/);
  const useful = [];
  for (const line of lines) {
    if (/^##\s+覆盖的\s+arxiv_id/i.test(line)) break;
    if (/^以下自\s+\*\*.*arxiv_id/i.test(line)) break;
    useful.push(line);
  }

  const highlights = useful
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line.replace(/^\s*-\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean);

  const paragraphs = useful
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('**日期**'));

  return {
    short: paragraphs[0] || highlights[0] || '已生成 AI 中文点评。',
    highlights,
  };
}

function inferTags(paper) {
  const text = `${paper.title || ''}\n${paper.abstract_text || paper.abstract || ''}`.toLowerCase();
  const tags = new Set();
  const has = (...words) => words.some((word) => text.includes(word));
  const add = (tag) => tags.add(tag);

  if (has('agent', 'tool use', 'webshop', 'alfworld', 'sciworld')) add('Agents');
  if (has('benchmark', 'dataset', 'evaluation', 'bench')) add('Benchmarks');
  if (has('diffusion', 'denoising', 'score matching')) add('Diffusion');
  if (has('reinforcement learning', 'grpo', 'policy', 'reward', 'rl ')) add('RL');
  if (has('video', 'vision', 'multimodal', 'image', 'audio', 'vlm')) add('Multimodal');
  if (has('long-context', 'long context', 'long-horizon', 'context')) add('Long-context');
  if (has('mixture of experts', 'moe', 'expert pool')) add('MoE');
  if (has('safety', 'alignment', 'trust', 'robustness')) add('Safety');
  if (has('kernel', 'gpu', 'triton', 'systems')) add('Systems');
  if (has('math', 'mathematician', 'theorem', 'logic')) add('Math');
  if (has('table', 'tabular', 'spreadsheet')) add('Tables');
  if (has('robot', 'driving', 'autonomous', 'action model')) add('Robotics');
  if (has('geospatial', 'remote sensing', 'satellite')) add('Geo');
  if (has('music', 'piano', 'midi')) add('Music');
  if (has('biomedical', 'bio', 'protein', 'ncbi', 'uniprot')) add('Bio');

  const category = paper.primary_category || '';
  if (category.includes('cs.CL')) add('NLP');
  if (category.includes('cs.CV')) add('CV');
  if (category.includes('cs.LG')) add('ML');

  return [...tags].sort((a, b) => a.localeCompare(b));
}

function getTags(papers) {
  const counts = groupByTag(papers);
  return Object.keys(counts).sort((a, b) => counts[b].length - counts[a].length || a.localeCompare(b));
}

function groupByTag(papers) {
  const grouped = {};
  for (const paper of papers) {
    for (const tag of paper._tags) {
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push(paper);
    }
  }
  return grouped;
}

function firstSentence(text) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0] || cleaned;
  return sentence.length > 260 ? sentence.slice(0, 260).trim() + '…' : sentence;
}

function compactAuthors(authors, limit = 3) {
  if (!authors || !authors.length) return '作者未知';
  const shown = authors.slice(0, limit).join(', ');
  return authors.length > limit ? `${shown}，等 ${authors.length} 人` : shown;
}

function tagLabel(tag) {
  return TAG_LABELS[tag] || tag || '其他';
}

function toneFor(tag) {
  const tones = ['blue', 'violet', 'green', 'orange', 'rose', 'slate'];
  let score = 0;
  for (const ch of tag || 'AI') score += ch.charCodeAt(0);
  return tones[score % tones.length];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}
