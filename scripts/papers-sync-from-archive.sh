#!/usr/bin/env bash
# Merge ai-papers-daily archive/<DATE>/papers.json into ai-papers-web data/papers.json.
# Optional Chinese overlay for the static site: run
#   node scripts/enrich-papers-zh.mjs --date YYYY-MM-DD
# (writes data/papers.zh.json; OpenAI key recommended — see script header).
# Usage:
#   export AI_PAPERS_ARCHIVE=/path/to/archive   # required
#   ./scripts/papers-sync-from-archive.sh [--push] [--date YYYY-MM-DD]...
# Default dates: Asia/Shanghai yesterday + today (GNU date); override with repeated --date.
set -euo pipefail

PUSH=0
DATES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --date)
      [[ $# -ge 2 ]] || { echo "missing value for --date" >&2; exit 2; }
      DATES+=("$2"); shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_JSON="$WEB_ROOT/data/papers.json"

if [[ -z "${AI_PAPERS_ARCHIVE:-}" ]]; then
  echo "set AI_PAPERS_ARCHIVE to the archive root (parent of YYYY-MM-DD/)" >&2
  exit 1
fi

export PATH="${HOME}/.cargo/bin:${HOME}/.local/bin:${HOME}/.local/bin-dev:${PATH}"

if ! command -v ai-papers-daily >/dev/null 2>&1; then
  echo "ai-papers-daily not in PATH. Install: https://github.com/aCoder2013/ai-paper-daily" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ ${#DATES[@]} -eq 0 ]]; then
  TZ_SH=Asia/Shanghai
  today=$(TZ="$TZ_SH" date +%F)
  yesterday=$(TZ="$TZ_SH" date -d yesterday +%F 2>/dev/null || TZ="$TZ_SH" date -v-1d +%F)
  DATES=("$yesterday" "$today")
fi

papers_count() {
  local f="$1"
  [[ -f "$f" ]] || { echo 0; return; }
  jq 'if type == "array" then length elif (.papers | type) == "array" then (.papers | length) else 0 end' "$f"
}

normalize_file() {
  local f="$1"
  jq '
    (if type == "array" then . elif (.papers | type) == "array" then .papers else [] end)
    | map(
        . as $p
        | ($p.arxiv_id // "") as $id
        | ($p.title // "") as $t
        | $p
        | {
            arxiv_id: $id,
            title: $t,
            authors: (.authors // []),
            abstract_text: (.abstract_text // .abstract // ""),
            published: (.published // null),
            pdf_url: ((.pdf_url // "") | if length > 0 then . elif ($id | length) > 0 then "https://arxiv.org/pdf/\($id).pdf" else null end),
            abs_url: ((.abs_url // "") | if length > 0 then . elif ($id | length) > 0 then "https://arxiv.org/abs/\($id)" else null end),
            primary_category: (.primary_category // null)
          }
      )
  ' "$f"
}

for d in "${DATES[@]}"; do
  f="$AI_PAPERS_ARCHIVE/$d/papers.json"
  n=$(papers_count "$f")
  if [[ "$n" -eq 0 ]]; then
    echo "[sync] fetching $d into $AI_PAPERS_ARCHIVE (may take several minutes)..." >&2
    ai-papers-daily fetch --date "$d" --output "$AI_PAPERS_ARCHIVE" >&2 || exit $?
    n=$(papers_count "$f")
    if [[ "$n" -eq 0 ]]; then
      echo "[sync] warning: still 0 papers for $d after fetch" >&2
    fi
  else
    echo "[sync] $d already has $n papers, skip fetch" >&2
  fi
done

[[ -f "$DATA_JSON" ]] || { echo "missing $DATA_JSON" >&2; exit 1; }

tmp="$(mktemp)"
cp "$DATA_JSON" "$tmp"
for d in "${DATES[@]}"; do
  f="$AI_PAPERS_ARCHIVE/$d/papers.json"
  [[ -f "$f" ]] || { echo "missing archive file $f" >&2; exit 1; }
  inc="$(normalize_file "$f")"
  jq --argjson papers "$inc" --arg d "$d" '.[$d] = $papers' "$tmp" >"${tmp}.new"
  mv "${tmp}.new" "$tmp"
done

if cmp -s "$tmp" "$DATA_JSON"; then
  echo "[sync] data/papers.json unchanged" >&2
  rm -f "$tmp"
else
  mv "$tmp" "$DATA_JSON"
  echo "[sync] updated data/papers.json" >&2
fi

if [[ "$PUSH" -eq 1 ]]; then
  git -C "$WEB_ROOT" add data/papers.json
  if git -C "$WEB_ROOT" diff --cached --quiet; then
    echo "[sync] nothing to commit" >&2
  else
    msg="chore(data): sync daily papers (${DATES[*]})"
    git -C "$WEB_ROOT" commit -m "$msg"
    git -C "$WEB_ROOT" push
  fi
fi
