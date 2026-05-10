#!/usr/bin/env node
/**
 * Fill data/papers.zh.json from data/papers.json using machine translation.
 *
 * Layout written:
 *   { "YYYY-MM-DD": { "<arxiv_id>": { "title_zh", "gist_zh", "abstract_zh" } } }
 *
 * Usage:
 *   export OPENAI_API_KEY=...   # recommended (model: gpt-4o-mini)
 *   node scripts/enrich-papers-zh.mjs --date 2026-05-10 [--force] [--dry-run]
 *
 * Without OpenAI key, falls back to MyMemory public API (rate/length limits; best-effort).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PAPERS = path.join(ROOT, 'data', 'papers.json');
const PAPERS_ZH = path.join(ROOT, 'data', 'papers.zh.json');

function parseArgs(argv) {
  const out = { dates: [], force: false, dryRun: false, limit: Infinity, provider: 'auto' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date' && argv[i + 1]) {
      out.dates.push(argv[++i]);
    } else if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit' && argv[i + 1]) {
      out.limit = Number(argv[++i]);
      if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = Infinity;
    } else if (a === '--provider' && argv[i + 1]) {
      out.provider = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/enrich-papers-zh.mjs --date YYYY-MM-DD [--force] [--dry-run] [--limit N] [--provider auto|openai|mymemory]`);
      process.exit(0);
    }
  }
  return out;
}

function englishGist(abstract) {
  if (!abstract || typeof abstract !== 'string') return '';
  const t = abstract.trim();
  if (!t) return '';
  const cut = t.split(/(?<=[.!?])\s+/)[0] || t.split('\n')[0] || t;
  return cut.length > 360 ? cut.slice(0, 360).trim() + '…' : cut;
}

function stripJsonFence(s) {
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return t.trim();
}

async function translateOpenAI(title, abstract, apiKey) {
  const gistSrc = englishGist(abstract);
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.25,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You translate ML/CS paper metadata into Simplified Chinese. Return compact JSON only.',
      },
      {
        role: 'user',
        content: `Translate the following. JSON keys: title_zh, gist_zh, abstract_zh.
- title_zh: natural Chinese title (not literal word-by-word if awkward).
- gist_zh: exactly ONE short sentence (<= 45 Chinese characters if possible) stating the core problem + method/contribution for quick scanning.
- abstract_zh: full faithful translation of the abstract.

Title: ${title}

Abstract:
${abstract}

English one-sentence lead (hint): ${gistSrc}`,
      },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(stripJsonFence(text));
  return {
    title_zh: String(parsed.title_zh || '').trim(),
    gist_zh: String(parsed.gist_zh || '').trim(),
    abstract_zh: String(parsed.abstract_zh || '').trim(),
  };
}

async function translateMyMemoryChunk(text) {
  const q = text.slice(0, 480);
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(q) +
    '&langpair=en|zh-CN';
  // Some environments fail Node fetch() due to TLS/proxy cert chains while curl works.
  const raw = execFileSync('curl', ['-sS', '-m', '20', url], { encoding: 'utf8' });
  const j = JSON.parse(raw);
  if (j.responseStatus !== 200) {
    throw new Error(j.responseData?.error || 'MyMemory error');
  }
  return String(j.responseData?.translatedText || '').trim();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function translateMyMemory(title, abstract) {
  const titleZh = await translateMyMemoryChunk(title || 'untitled');
  await sleep(400);
  const gistEn = englishGist(abstract);
  const gistZh = await translateMyMemoryChunk(`Summary in one sentence: ${gistEn}`);
  await sleep(400);
  const parts = [];
  const abs = abstract || '';
  for (let i = 0; i < abs.length; i += 420) {
    parts.push(await translateMyMemoryChunk(abs.slice(i, i + 420)));
    await sleep(450);
  }
  return {
    title_zh: titleZh,
    gist_zh: gistZh,
    abstract_zh: parts.join(''),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.dates.length) {
    console.error('Need at least one --date YYYY-MM-DD');
    process.exit(2);
  }

  const raw = await fs.readFile(PAPERS, 'utf8');
  const papers = JSON.parse(raw);

  let zh = {};
  try {
    zh = JSON.parse(await fs.readFile(PAPERS_ZH, 'utf8'));
  } catch {
    zh = {};
  }

  const apiKey = process.env.OPENAI_API_KEY || '';
  let provider = args.provider;
  if (provider === 'auto') provider = apiKey ? 'openai' : 'mymemory';

  let done = 0;
  for (const date of args.dates) {
    const list = papers[date];
    if (!Array.isArray(list)) {
      console.warn('[skip] no papers for', date);
      continue;
    }
    if (!zh[date] || typeof zh[date] !== 'object') zh[date] = {};

    for (const p of list) {
      if (done >= args.limit) break;
      const id = p.arxiv_id;
      if (!id) continue;
      const prev = zh[date][id];
      if (
        prev &&
        !args.force &&
        prev.title_zh &&
        prev.gist_zh &&
        prev.abstract_zh
      ) {
        continue;
      }

      const title = p.title || '';
      const abstract = p.abstract_text || p.abstract || '';

      console.log(`[${provider}] ${date} ${id} …`);
      let pack;
      try {
        if (provider === 'openai') {
          if (!apiKey) throw new Error('OPENAI_API_KEY missing');
          pack = await translateOpenAI(title, abstract, apiKey);
        } else {
          pack = await translateMyMemory(title, abstract);
        }
      } catch (e) {
        console.error('[error]', id, e.message);
        continue;
      }

      if (args.dryRun) {
        console.log(JSON.stringify(pack, null, 2));
        done++;
        continue;
      }
      zh[date][id] = pack;
      done++;
      await fs.writeFile(PAPERS_ZH, JSON.stringify(zh, null, 2) + '\n', 'utf8');
    }
  }

  console.log('[done] updated entries:', done, args.dryRun ? '(dry-run, papers.zh.json unchanged)' : '');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
