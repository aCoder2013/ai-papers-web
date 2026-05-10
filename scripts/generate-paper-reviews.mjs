#!/usr/bin/env node
/**
 * 从 data/papers.json 按日期读取论文，按每批 10 篇导出「待填写中文点评」模板，合并为站点可用的 data/reviews/YYYY-MM-DD.json。
 *
 * 不涉及任何第三方 LLM HTTP 调用，也不需要 API 密钥：正文由你在 Cursor/对话里写好，填回 stub JSON 的 review_zh 字段即可。
 *
 * 并行子代理约定：同一天开多个子代理，各自负责一批 —— batch 0 对应论文索引 0～9，batch 1 对应 10～19，依此类推。
 *
 * 示例：
 *   node scripts/generate-paper-reviews.mjs list-batches --date 2026-05-10
 *   node scripts/generate-paper-reviews.mjs export --date 2026-05-10 --batch-index 0
 *   node scripts/generate-paper-reviews.mjs export --date 2026-05-10 --offset 20 --limit 10
 *   node scripts/generate-paper-reviews.mjs merge --date 2026-05-10
 *   node scripts/generate-paper-reviews.mjs validate --date 2026-05-10 --stubs
 *   node scripts/generate-paper-reviews.mjs validate --date 2026-05-10 --strict
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAPERS_JSON = path.join(ROOT, 'data', 'papers.json');
const REVIEWS_DIR = path.join(ROOT, 'data', 'reviews');
const STUBS_DIR = path.join(REVIEWS_DIR, 'stubs');
const BATCH_SIZE = 10;

const COMMANDS = new Set(['list-batches', 'export', 'merge', 'validate', 'help']);

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

/** 无 arXiv 时的稳定键（与 app.js 完全一致；勿改用 Node crypto，以便浏览器可对齐） */
function hashTitleKey(title) {
  const s = String(title || '').trim();
  if (!s) return '';
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return `title:${h.toString(16)}`;
}

/** 与 app.js 中 stablePaperId 保持一致 */
function stablePaperId(paper) {
  const raw = normalizeArxivId(paper.arxiv_id);
  if (raw) return raw;
  const u = extractArxivFromUrl(paper.abs_url) || extractArxivFromUrl(paper.pdf_url);
  if (u) return u;
  return hashTitleKey(paper.title);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const tokens = argv.slice(2);
  let command = '';

  if (tokens[0] && COMMANDS.has(tokens[0])) {
    command = tokens.shift();
  }

  const out = {
    command,
    date: '',
    batchIndex: null,
    offset: null,
    limit: BATCH_SIZE,
    listBatches: false,
    force: false,
    help: false,
    promptOnly: false,
    noPrompt: false,
    stubs: false,
    strict: false,
  };

  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--list-batches') out.listBatches = true;
    else if (a === '--force') out.force = true;
    else if (a === '--prompt-only') out.promptOnly = true;
    else if (a === '--no-prompt') out.noPrompt = true;
    else if (a === '--stubs') out.stubs = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--date') out.date = tokens[++i] || '';
    else if (a === '--batch-index') out.batchIndex = Number(tokens[++i]);
    else if (a === '--offset') out.offset = Number(tokens[++i]);
    else if (a === '--limit') out.limit = Number(tokens[++i]);
    else throw new Error(`未知参数: ${a}`);
  }

  if (!command && out.listBatches) command = 'list-batches';
  if (
    !command &&
    ((out.batchIndex != null && !Number.isNaN(out.batchIndex)) ||
      (out.offset != null && !Number.isNaN(out.offset)))
  ) {
    command = 'export';
  }

  out.command = command;
  return out;
}

function usage() {
  console.log(`
用法（子命令）:
  node scripts/generate-paper-reviews.mjs list-batches --date YYYY-MM-DD
  node scripts/generate-paper-reviews.mjs export --date YYYY-MM-DD --batch-index K [选项]
  node scripts/generate-paper-reviews.mjs export --date YYYY-MM-DD --offset N --limit M [选项]
  node scripts/generate-paper-reviews.mjs merge --date YYYY-MM-DD [--force]
  node scripts/generate-paper-reviews.mjs validate --date YYYY-MM-DD [--stubs] [--strict]

export 选项:
  --prompt-only   仅向 stdout 打印供 Cursor 使用的说明与论文列表，不写 stub 文件
  --no-prompt     仅写入 stub JSON，不打印长文案（batch 模式：DATE-batchK.json；offset 模式：DATE-offsetN-limitM.json）

说明:
  --batch-index K : 第 K 批（从 0 起），覆盖论文索引 [K*${BATCH_SIZE}, K*${BATCH_SIZE}+9]（当日列表内截断）。
  --offset / --limit: 显式切片（与 batch-index 二选一）。
  merge 会读取 ${path.relative(ROOT, STUBS_DIR)}/DATE-*.json，汇总非空 review_zh，写入 ${path.relative(ROOT, REVIEWS_DIR)}/DATE.json（结构含 reviews[id]，与 app.js 一致）。
  validate --stubs : 检查 stub 是否含必填字段、review_zh 是否仍为空。
  validate --strict : 在校验最终 JSON 的基础上，对照 papers.json 检查当日每篇是否都有非空点评。
`);
}

function sliceBatch(papers, batchIndex, offset, limit) {
  let start;
  let len = limit > 0 ? limit : BATCH_SIZE;
  if (offset != null && !Number.isNaN(offset)) {
    start = Math.max(0, offset);
  } else if (batchIndex != null && !Number.isNaN(batchIndex)) {
    start = Math.max(0, batchIndex) * BATCH_SIZE;
  } else {
    throw new Error('export 须指定 --batch-index 或 --offset');
  }
  return { slice: papers.slice(start, start + len), start };
}

function stubPathBatch(date, batchIndex) {
  return path.join(STUBS_DIR, `${date}-batch${batchIndex}.json`);
}

function stubPathOffset(date, start, len) {
  return path.join(STUBS_DIR, `${date}-offset${start}-limit${len}.json`);
}

function buildPromptText(date, batchLabel, startIdx, batch) {
  const lines = batch.map((p, i) => {
    const id = stablePaperId(p);
    const abs = (p.abstract_text || p.abstract || '').slice(0, 1200);
    return `${i + 1}. stable_id=${id}\n标题: ${p.title || ''}\n摘要: ${abs}`;
  });
  return `【日期 ${date} · ${batchLabel} · 论文索引 ${startIdx}～${startIdx + batch.length - 1}】
请在仓库内的 stub 文件中为每一项填写 "review_zh"（简体中文，约 120～280 字）：概括贡献与适用场景，可点出局限；语气客观。
合并命令：node scripts/generate-paper-reviews.mjs merge --date ${date}

论文列表：
${lines.join('\n\n')}
`;
}

function buildStub(date, batchIndex, startIdx, batch) {
  return {
    version: 1,
    kind: 'review-batch-stub',
    date,
    batch_index: batchIndex,
    batch_size: BATCH_SIZE,
    paper_index_range: [startIdx, startIdx + batch.length - 1],
    papers: batch.map((p) => ({
      stable_id: stablePaperId(p),
      title: p.title || '',
      abstract: (p.abstract_text || p.abstract || '').slice(0, 2000),
      review_zh: '',
    })),
    merge_hint_zh:
      '填完本文件的 review_zh 后保存；全部批次完成后运行：node scripts/generate-paper-reviews.mjs merge --date ' +
      date,
  };
}

function mergeArtifact(existing, incomingReviews, meta, { force }) {
  const prev = existing && typeof existing === 'object' ? existing : {};
  const reviews = { ...(prev.reviews && typeof prev.reviews === 'object' ? prev.reviews : {}) };
  for (const [k, v] of Object.entries(incomingReviews)) {
    const next = String(v || '').trim();
    if (!next) continue;
    const has = reviews[k] && String(reviews[k]).trim();
    if (has && !force) continue;
    reviews[k] = next;
  }
  return {
    version: 1,
    date: meta.date,
    batch_size: BATCH_SIZE,
    updated_at: new Date().toISOString(),
    reviews,
  };
}

function listStubFiles(date) {
  if (!fs.existsSync(STUBS_DIR)) return [];
  const prefix = `${date}-`;
  return fs
    .readdirSync(STUBS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .map((name) => path.join(STUBS_DIR, name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

function readStubIncoming(stubFiles, { force }) {
  const incoming = {};
  for (const file of stubFiles) {
    let data;
    try {
      data = readJson(file);
    } catch (e) {
      throw new Error(`无法解析 stub: ${file}: ${e.message}`);
    }
    if (data.kind !== 'review-batch-stub') {
      console.warn(`[merge warn] ${file} 缺少 kind=review-batch-stub，仍尝试读取 papers`);
    }

    const papers = Array.isArray(data.papers) ? data.papers : [];
    for (const row of papers) {
      const id = row.stable_id != null ? String(row.stable_id).trim() : '';
      const zh = String(row.review_zh || '').trim();
      if (!id) continue;
      if (!zh) continue;
      if (incoming[id] != null && incoming[id] !== zh) {
        if (force) incoming[id] = zh;
        else throw new Error(`stable_id ${id} 在多个 stub 中 review_zh 不一致（可用 --force 选用后者）`);
      } else {
        incoming[id] = zh;
      }
    }
  }
  return incoming;
}

function cmdListBatches(date, papers) {
  const total = papers.length;
  const batchCount = total === 0 ? 0 : Math.ceil(total / BATCH_SIZE);
  console.log(`date=${date} papers=${total} batch_size=${BATCH_SIZE} batch_count=${batchCount}`);
  for (let b = 0; b < batchCount; b++) {
    const s = b * BATCH_SIZE;
    const e = Math.min(s + BATCH_SIZE, total);
    console.log(`  batch ${b}: indices ${s}..${e - 1} (${e - s} papers)`);
  }
}

function cmdExport(args, papers) {
  const useOffset = args.offset != null && !Number.isNaN(args.offset);
  const useBatch = args.batchIndex != null && !Number.isNaN(args.batchIndex);
  if (useOffset === useBatch) {
    console.error('export：请只指定其一：--batch-index K 或 --offset N（配合 --limit）');
    process.exit(2);
  }

  const batchIndexMeta = useBatch ? Math.max(0, args.batchIndex) : null;
  const { slice: batch, start } = sliceBatch(papers, args.batchIndex, args.offset, args.limit);
  if (!batch.length) {
    console.error('当前批次没有论文（索引越界）');
    process.exit(1);
  }

  const stub = buildStub(args.date, batchIndexMeta, start, batch);
  const batchLabel = useBatch ? `batch ${batchIndexMeta}` : `offset ${start} limit ${batch.length}`;
  const prompt = buildPromptText(args.date, batchLabel, start, batch);
  const outFile = useBatch ? stubPathBatch(args.date, batchIndexMeta) : stubPathOffset(args.date, start, batch.length);

  if (!args.promptOnly) {
    writeJson(outFile, stub);
    console.error(`[export] wrote ${outFile}`);
  }
  if (!args.noPrompt) {
    process.stdout.write(prompt);
  }
}

function cmdMerge(args, papers) {
  const stubFiles = listStubFiles(args.date);
  if (!stubFiles.length) {
    console.error(`未找到 ${STUBS_DIR}/${args.date}-*.json，请先 export 各批`);
    process.exit(1);
  }

  const incoming = readStubIncoming(stubFiles, { force: args.force });
  const outPath = path.join(REVIEWS_DIR, `${args.date}.json`);
  let existing = {};
  if (fs.existsSync(outPath)) {
    try {
      existing = readJson(outPath);
    } catch {
      existing = {};
    }
  }

  const merged = mergeArtifact(existing, incoming, { date: args.date }, { force: args.force });
  writeJson(outPath, merged);
  const expectedIds = new Set(papers.map(stablePaperId));
  const missing = [...expectedIds].filter((id) => !String(merged.reviews[id] || '').trim());
  console.error(`[merge] wrote ${outPath} (reviews keys: ${Object.keys(merged.reviews).length}, stubs: ${stubFiles.length})`);
  if (missing.length) {
    console.error(`[merge hint] 尚有 ${missing.length} 篇当日论文缺少点评（merge 只写入 stub 里非空的 review_zh）`);
  }
}

function validateFinalSchema(obj) {
  const errs = [];
  if (!obj || typeof obj !== 'object') errs.push('根须为对象');
  if (obj.version !== 1) errs.push(`version 应为 1，实为 ${obj.version}`);
  if (!obj.date || typeof obj.date !== 'string') errs.push('缺少字符串 date');
  if (!obj.reviews || typeof obj.reviews !== 'object') errs.push('缺少 reviews 对象');
  return errs;
}

function cmdValidate(args, papers) {
  if (args.stubs) {
    const stubFiles = listStubFiles(args.date);
    if (!stubFiles.length) {
      console.error('无 stub 文件可校验');
      process.exit(1);
    }
    let emptyCount = 0;
    for (const file of stubFiles) {
      const data = readJson(file);
      const papersRows = Array.isArray(data.papers) ? data.papers : [];
      if (!papersRows.length) console.warn(`[validate] ${file}: papers 为空`);
      for (const row of papersRows) {
        if (!row.stable_id) console.warn(`[validate] ${file}: 缺少 stable_id`);
        if (!String(row.review_zh || '').trim()) emptyCount++;
      }
    }
    if (emptyCount) {
      console.error(`[validate] stubs：尚有 ${emptyCount} 条 review_zh 为空`);
      process.exit(1);
    }
    console.error('[validate] stubs：字段与 review_zh 非空检查通过');
    return;
  }

  const outPath = path.join(REVIEWS_DIR, `${args.date}.json`);
  if (!fs.existsSync(outPath)) {
    console.error(`缺少 ${outPath}`);
    process.exit(1);
  }
  const obj = readJson(outPath);
  const errs = validateFinalSchema(obj);
  if (errs.length) {
    console.error('[validate] final:', errs.join('; '));
    process.exit(1);
  }
  for (const [k, v] of Object.entries(obj.reviews)) {
    if (typeof v !== 'string' || !v.trim()) console.warn(`[validate] reviews[${k}] 为空或非字符串`);
  }
  if (args.strict) {
    const expectedIds = papers.map(stablePaperId);
    const missing = expectedIds.filter((id) => !String(obj.reviews[id] || '').trim());
    if (missing.length) {
      console.error(`[validate] strict：缺少 ${missing.length} 篇点评（示例 id: ${missing.slice(0, 5).join(', ')}）`);
      process.exit(1);
    }
  }
  console.error('[validate] final JSON 模式检查通过');
}

function requireDate(args) {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    console.error('请提供合法 --date YYYY-MM-DD');
    usage();
    process.exit(2);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || args.command === 'help') {
    usage();
    process.exit(0);
  }

  let cmd = args.command;
  if (!cmd) {
    console.error('请指定子命令：list-batches | export | merge | validate（或 export 时使用 --batch-index / --offset）');
    usage();
    process.exit(2);
  }

  requireDate(args);

  const papersRoot = readJson(PAPERS_JSON);
  const papers = papersRoot[args.date];
  if (!Array.isArray(papers)) {
    console.error(`papers.json 中没有日期 ${args.date}`);
    process.exit(1);
  }

  switch (cmd) {
    case 'list-batches':
      cmdListBatches(args.date, papers);
      break;
    case 'export':
      cmdExport(args, papers);
      break;
    case 'merge':
      cmdMerge(args, papers);
      break;
    case 'validate':
      cmdValidate(args, papers);
      break;
    default:
      console.error(`未知子命令: ${cmd}`);
      usage();
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
