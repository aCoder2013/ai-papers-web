// Bookshelf-style AI papers library.
// Data: ./data/papers.json
// AI review: ./data/analysis/YYYY-MM-DD.summary.md

const DATA_URL = './data/papers.json';

const state = {
  data: {},
  dates: [],
  activeDate: '',
  activeTag: '',
  activePaper: null,
  reviewByDate: {},
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`papers.json HTTP ${res.status}`);
    state.data = await res.json();
  } catch (error) {
    setLoading(`Failed to load data: ${error.message}`);
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
    option.textContent = `${date} (${getPapers(date).length})`;
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

  document.getElementById('hero-date').textContent = date || 'No date';
  document.getElementById('hero-count').textContent = `${papers.length} papers`;
  document.getElementById('paper-count').textContent = `${papers.length} papers`;

  fillTagSelect(tags);
  renderTagChips(tags);
  renderShelves();
  renderReader(null);
  await renderReview(date);
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
  all.textContent = 'All categories';
  select.appendChild(all);

  for (const tag of tags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
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
    button.textContent = `${tag} ${papers.filter((p) => p._tags.includes(tag)).length}`;
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
    ? `${state.activeTag} shelf`
    : 'Recommended shelves';
  document.getElementById('paper-count').textContent = `${visible.length} papers`;

  if (!visible.length) {
    root.innerHTML = '<div class="empty">No papers match this category.</div>';
    return;
  }

  if (state.activeTag) {
    root.appendChild(renderShelf(state.activeTag, visible));
    return;
  }

  const grouped = groupByTag(all);
  const shelfOrder = Object.keys(grouped)
    .sort((a, b) => grouped[b].length - grouped[a].length || a.localeCompare(b))
    .slice(0, 8);

  for (const tag of shelfOrder) {
    root.appendChild(renderShelf(tag, grouped[tag].slice(0, 12)));
  }
}

function renderShelf(tag, papers) {
  const section = document.createElement('section');
  section.className = 'shelf-section';

  const header = document.createElement('div');
  header.className = 'shelf-header';

  const titleWrap = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Category';
  const title = document.createElement('h3');
  title.textContent = tag;
  titleWrap.append(eyebrow, title);

  const count = document.createElement('span');
  count.className = 'pill';
  count.textContent = `${papers.length} shown`;
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
  button.addEventListener('click', () => {
    state.activePaper = paper;
    document.querySelectorAll('.book-card').forEach((card) => card.classList.remove('active'));
    button.classList.add('active');
    renderReader(paper);
  });

  const cover = document.createElement('div');
  cover.className = `book-cover tone-${toneFor(paper._tags[0])}`;
  const label = document.createElement('span');
  label.textContent = paper._tags[0] || 'AI';
  const title = document.createElement('strong');
  title.textContent = paper.title || '(untitled)';
  cover.append(label, title);

  const gist = document.createElement('p');
  gist.className = 'book-gist';
  gist.textContent = paper._gist || 'Open this paper to read the abstract and AI review.';

  const meta = document.createElement('div');
  meta.className = 'book-meta';
  meta.textContent = compactAuthors(paper.authors);

  button.append(cover, gist, meta);
  return button;
}

function renderReader(paper) {
  const reader = document.getElementById('reader');
  reader.innerHTML = '';

  if (!paper) {
    const empty = document.createElement('div');
    empty.className = 'reader-empty';
    empty.innerHTML = `
      <span class="book-icon">▰</span>
      <h2>Pick a paper</h2>
      <p>Click a book card on the shelf to open its abstract, authors, original links, PDF, and the Chinese AI review for the day.</p>
    `;
    reader.appendChild(empty);
    return;
  }

  const spread = document.createElement('div');
  spread.className = 'book-spread';

  const left = document.createElement('section');
  left.className = 'page page-left';
  left.appendChild(el('p', 'eyebrow', paper._tags.join(' / ')));
  left.appendChild(el('h2', '', paper.title || '(untitled)'));
  left.appendChild(el('p', 'lead', paper._gist || 'No short gist available.'));

  const author = el('p', 'reader-meta', compactAuthors(paper.authors, 12));
  left.appendChild(author);

  const links = document.createElement('div');
  links.className = 'reader-links';
  if (paper.abs_url) links.appendChild(linkButton('Open original', paper.abs_url));
  if (paper.pdf_url) links.appendChild(linkButton('Read PDF', paper.pdf_url));
  left.appendChild(links);

  const right = document.createElement('section');
  right.className = 'page page-right';
  right.appendChild(el('p', 'eyebrow', 'Abstract'));
  right.appendChild(el('p', 'abstract-reader', paper._abstract || 'No abstract available.'));

  const review = state.reviewByDate[paper._date];
  const reviewBox = document.createElement('div');
  reviewBox.className = 'reader-review';
  reviewBox.appendChild(el('p', 'eyebrow', 'AI Review / 中文点评'));
  reviewBox.appendChild(el('p', '', review?.short || '这一天暂无 AI 总结。'));
  right.appendChild(reviewBox);

  spread.append(left, right);
  reader.appendChild(spread);
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
  const reviewLink = document.getElementById('review-link');
  root.innerHTML = '<p class="muted">Loading AI review…</p>';
  reviewLink.href = `./data/analysis/${date}.summary.md`;

  const review = await loadReview(date);
  state.reviewByDate[date] = review;

  if (!review) {
    root.innerHTML = '<p class="muted">No AI review for this date yet.</p>';
    return;
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

async function loadReview(date) {
  const url = `./data/analysis/${date}.summary.md`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const md = await res.text();
    return parseReview(md);
  } catch {
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
  if (!authors || !authors.length) return 'Unknown authors';
  const shown = authors.slice(0, limit).join(', ');
  return authors.length > limit ? `${shown}, +${authors.length - limit} more` : shown;
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
