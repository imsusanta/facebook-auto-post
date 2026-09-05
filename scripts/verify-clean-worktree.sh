#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)" || exit 1
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)" || exit 1
cd -- "$REPO_DIR" || exit 1
WORK_DIR=""
PROOF_MARKER=""
PROOF_CLEANUP_FAIL=0
ALL_GATES_PASSED=0
cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT
  set +e
  if [[ -n "$PROOF_MARKER" ]]; then
    printf 'cleanup-ran\n' > "$PROOF_MARKER" || cleanup_status=1
    if [[ "$PROOF_CLEANUP_FAIL" == 1 ]]; then cleanup_status=74; fi
  fi
  if [[ -n "$WORK_DIR" ]]; then
    if [[ -f "$WORK_DIR/schema" ]]; then
      timeout --kill-after=5s 30s node scripts/cleanup-test-schema.js || cleanup_status=$?
    fi
    rm -rf -- "$WORK_DIR" || cleanup_status=$?
  fi
  if (( status == 0 && cleanup_status != 0 )); then status=$cleanup_status; fi
  if (( status != 0 )); then echo "Verification failed (exit $status)." >&2; fi
  if (( status == 0 && ALL_GATES_PASSED == 1 )); then echo "PASS: all validation and cleanup gates passed at $EXPECTED_HEAD."; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
run() {
  local label="$1"; shift
  printf '\n>>> %s\n' "$label"
  timeout --kill-after=15s "${VALIDATION_TIMEOUT_SECONDS:-180}s" "$@"
}
# Both proofs exercise the SAME run() and EXIT trap as the real validation path.
case "${1:-}" in
  --internal-failure-proof)
    PROOF_MARKER="${2:?}"; run 'deliberately failing validation' bash -c 'exit 37'; exit 0 ;;
  --internal-cleanup-proof)
    PROOF_MARKER="${2:?}"; PROOF_CLEANUP_FAIL=1; run 'successful validation' true; exit 0 ;;
  --test-failure-mode)
    WORK_DIR="$(mktemp -d)"
    code=0
    bash "$0" --internal-failure-proof "$WORK_DIR/marker" || code=$?
    [[ "$code" == 37 && -s "$WORK_DIR/marker" ]] || exit 1
    code=0
    bash "$0" --internal-cleanup-proof "$WORK_DIR/cleanup-marker" || code=$?
    [[ "$code" == 74 && -s "$WORK_DIR/cleanup-marker" ]] || exit 1
    echo 'PASS: validation failure preserved (37); cleanup failure is non-zero (74).'
    exit 0 ;;
  '') ;;
  *) echo 'Unknown verification option.' >&2; exit 2 ;;
esac
[[ "${VALIDATION_TIMEOUT_SECONDS:-180}" =~ ^[1-9][0-9]*$ ]] || exit 2
[[ "${EXPECTED_HEAD:-}" =~ ^[a-f0-9]{40}$ ]] || { echo 'EXPECTED_HEAD must be an exact committed SHA.' >&2; exit 2; }
[[ "$(git rev-parse HEAD)" == "$EXPECTED_HEAD" ]] || { echo 'HEAD mismatch.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Worktree is not clean.' >&2; exit 1; }
[[ ! -L node_modules ]] || { echo 'Dependency-directory symlinks are prohibited.' >&2; exit 1; }
if [[ -d node_modules ]] && [[ -n "$(find node_modules -mindepth 1 -maxdepth 2 -type l ! -path 'node_modules/.bin/*' -print -quit)" ]]; then
  echo 'Dependency-package symlinks are prohibited.' >&2; exit 1
fi
WORK_DIR="$(mktemp -d)"
export DATA_DIR="$WORK_DIR/data"
export PG_TEST_SCHEMA_FILE="$WORK_DIR/schema"
export NODE_ENV=test
unset STORAGE_MODE DEV_AUTH_BYPASS
# Opt-in and explicit URL must come from the caller, not from this script.
node -e "require('./db/safety-guard').resolveTestDatabaseUrl()"
echo "Verifying committed HEAD: $EXPECTED_HEAD"
run 'clean dependency installation' npm ci
run 'dependency audit (high/critical gate; report moderate findings)' npm audit --audit-level=high
run 'lint' npm run lint
run 'syntax' bash -c 'set -euo pipefail; while IFS= read -r -d "" file; do node --check "$file" >/dev/null; done < <(git ls-files -z "*.js")'
run 'encoding' npm run check:encoding
run 'database safety guard' npm run test:safety-guard
run 'legacy regressions' npm test
run 'PostgreSQL and real-auth integration' npm run test:postgres
run 'browser regressions' node tests/browser-test.js
run 'customer UI browser regressions' npm run test:browser:customer
run 'runner failure-mode proof' bash scripts/verify-clean-worktree.sh --test-failure-mode
[[ "$(git rev-parse HEAD)" == "$EXPECTED_HEAD" ]] || exit 1
[[ -z "$(git status --porcelain)" ]] || { echo 'Tests modified the worktree.' >&2; git status --short; exit 1; }
ALL_GATES_PASSED=1
