#!/usr/bin/env bash
# 카드 하나를 시작한다.
#   scripts/work.sh W1-M03                 # Codex로 (카드의 프로필에 맞는 모델·effort)
#   scripts/work.sh W1-M03 --tool claude   # Claude Code로 (Codex 한도 초과, 두 번 실패, 이어받기)
#   scripts/work.sh W1-M03 --dry-run       # 실행할 명령만 보여준다
#
# 하는 일: docs/10에서 카드의 프로필을 읽고 → 카드 전용 작업 폴더(git worktree)와
#          브랜치 feat/{카드ID}를 만들고 → 에이전트를 열어 "[작업] {카드ID}"를 보낸다.
# 이미 작업 폴더가 있으면 그 폴더에서 이어간다(.handoff/ 기록이 있으면 에이전트가 읽는다).
set -euo pipefail

# ---------- 설정 (여기만 고친다) ----------
PLAN_DOC="docs/10_dev_plan.md"
BASE_BRANCH="origin/develop"
BRANCH_PREFIX="feat/"
WORKTREE_PREFIX="trotyou-"                      # 저장소 옆에 trotyou-W1-M03 폴더가 생긴다
CODEX_BIN="${CODEX_BIN:-codex}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
CLAUDE_MAIN_MODEL="${CLAUDE_MAIN_MODEL:-claude-fable-5-1}"  # Fable 한도 소진 시: CLAUDE_MAIN_MODEL=claude-opus-5-5
CLAUDE_LIGHT_MODEL="${CLAUDE_LIGHT_MODEL:-claude-haiku-5-5}"
# 프로필 → Claude Code effort (docs/11 §3). Claude Code 버전에 따라 이 환경 변수 이름이 다르면 여기만 바꾼다.
CLAUDE_EFFORT_ENV="CLAUDE_CODE_EFFORT_LEVEL"
# -----------------------------------------

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
die() { echo "work.sh: $*" >&2; exit 1; }

CARD_ID=""; TOOL="codex"; DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool) TOOL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    -*) die "모르는 옵션: $1" ;;
    *) [[ -z "$CARD_ID" ]] || die "카드 ID는 하나만"; CARD_ID="$1"; shift ;;
  esac
done
[[ -n "$CARD_ID" ]] || usage
[[ "$CARD_ID" =~ ^W[0-9]-[A-Z][0-9]{2}$ ]] || die "카드 ID 형식이 아니다: $CARD_ID (예: W1-M03)"
[[ "$TOOL" == "codex" || "$TOOL" == "claude" ]] || die "--tool은 codex 또는 claude"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "git 저장소 안에서 실행한다"
DOC="$ROOT/$PLAN_DOC"
[[ -f "$DOC" ]] || die "$PLAN_DOC 가 없다"

# 카드 제목과 꼬리표 줄을 읽는다
grep -q "^#### ${CARD_ID} " "$DOC" || die "$PLAN_DOC 에 카드 ${CARD_ID} 가 없다"
TAG_LINE="$(grep -A1 "^#### ${CARD_ID} " "$DOC" | tail -n1)"
CARD_NAME="$(grep "^#### ${CARD_ID} " "$DOC" | head -n1 | sed "s/^#### ${CARD_ID} //")"
KIND="$(sed -n 's/.*`종류: \([^`]*\)`.*/\1/p' <<<"$TAG_LINE")"
PROFILE="$(sed -n 's/.*`프로필: \([^`]*\)`.*/\1/p' <<<"$TAG_LINE")"
[[ "$KIND" != "사람" ]] || die "${CARD_ID} 는 사람이 하는 카드다 (${CARD_NAME})"
[[ -n "$PROFILE" ]] || die "${CARD_ID} 의 프로필을 읽지 못했다: $TAG_LINE"

case "$PROFILE" in
  chore)    CLAUDE_MODEL="$CLAUDE_LIGHT_MODEL"; CLAUDE_EFFORT="low" ;;
  default)  CLAUDE_MODEL="$CLAUDE_MAIN_MODEL";  CLAUDE_EFFORT="medium" ;;
  high|critical|deep) CLAUDE_MODEL="$CLAUDE_MAIN_MODEL"; CLAUDE_EFFORT="high" ;;
  *) die "모르는 프로필: $PROFILE" ;;
esac

BRANCH="${BRANCH_PREFIX}${CARD_ID}"
WT_DIR="$(dirname "$ROOT")/${WORKTREE_PREFIX}${CARD_ID}"
PROMPT="[작업] ${CARD_ID}"

run() { if [[ $DRY_RUN -eq 1 ]]; then echo "[dry-run] $*"; else "$@"; fi; }

echo "카드: ${CARD_ID} ${CARD_NAME}"
echo "종류: ${KIND} · 프로필: ${PROFILE} · 도구: ${TOOL}"
[[ "$PROFILE" == "critical" ]] && echo "※ critical 카드: 에이전트가 계획만 내고 멈춘다. 검토 후 '승인'이라고 보낸다."

# 작업 폴더 준비
if [[ -d "$WT_DIR" ]]; then
  echo "작업 폴더가 이미 있다. 이어서 한다: $WT_DIR"
else
  run git -C "$ROOT" fetch origin
  if git -C "$ROOT" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    run git -C "$ROOT" worktree add "$WT_DIR" "$BRANCH"
  elif git -C "$ROOT" show-ref --verify --quiet "refs/remotes/origin/${BRANCH}"; then
    run git -C "$ROOT" worktree add --track -b "$BRANCH" "$WT_DIR" "origin/${BRANCH}"
  else
    # --no-track: 새 브랜치가 develop을 따라가지 않게 한다(실수로 develop에 push하는 것을 막는다)
    run git -C "$ROOT" worktree add --no-track -b "$BRANCH" "$WT_DIR" "$BASE_BRANCH"
  fi
fi

if [[ $DRY_RUN -eq 0 && -f "$WT_DIR/package-lock.json" && ! -d "$WT_DIR/node_modules" ]]; then
  (cd "$WT_DIR" && npm ci)
fi

# 에이전트 열기
if [[ "$TOOL" == "codex" ]]; then
  if [[ "$PROFILE" == "default" ]]; then CMD=("$CODEX_BIN" "$PROMPT")
  else CMD=("$CODEX_BIN" -p "$PROFILE" "$PROMPT"); fi
  if [[ $DRY_RUN -eq 1 ]]; then echo "[dry-run] (cd $WT_DIR) ${CMD[*]}"; exit 0; fi
  cd "$WT_DIR" && exec "${CMD[@]}"
else
  CMD=("$CLAUDE_BIN" --model "$CLAUDE_MODEL" "$PROMPT")
  if [[ $DRY_RUN -eq 1 ]]; then echo "[dry-run] (cd $WT_DIR) ${CLAUDE_EFFORT_ENV}=${CLAUDE_EFFORT} ${CMD[*]}"; exit 0; fi
  cd "$WT_DIR" && exec env "${CLAUDE_EFFORT_ENV}=${CLAUDE_EFFORT}" "${CMD[@]}"
fi
