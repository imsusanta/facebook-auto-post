#!/usr/bin/env bash
# ==============================================================================
# verify-clean-worktree.sh
# 
# Comprehensive verification runner for Facebook Auto-Poster & SaaS Tenancy.
# Enforces:
# 1. Zero uncommitted changes / clean worktree
# 2. ESLint code cleanliness
# 3. UTF-8 encoding / zero mojibake check
# 4. Safety Guard unit test suite
# 5. Core application & safety tests (npm test)
# 6. Headless Chrome browser integration tests (tests/browser-test.js)
# 7. PostgreSQL multi-tenancy & security suite (tests/postgres-runner.js)
# 8. Unaltered worktree post-run
#
# Supports:
#   --test-failure-mode   Injects deliberate errors to prove the runner fails closed.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

trap 'echo "[ERROR] Clean-worktree verification failed at line $LINENO" >&2; exit 1' ERR

# Failure mode demonstration
if [[ "${1:-}" == "--test-failure-mode" ]]; then
  echo "========================================================"
  echo ">>> RUNNING VERIFICATION FAILURE-MODE TEST"
  echo "========================================================"
  
  TMP_TEST_FILE="${REPO_DIR}/.tmp_failure_test_marker"
  echo "Creating deliberate dirty file: ${TMP_TEST_FILE}"
  touch "${TMP_TEST_FILE}"

  echo "Testing that uncommitted change causes verification failure..."
  set +e
  bash "${BASH_SOURCE[0]}" --internal-check > /dev/null 2>&1
  EXIT_CODE=$?
  set -e
  rm -f "${TMP_TEST_FILE}"

  if [ ${EXIT_CODE} -ne 0 ]; then
    echo "✅ SUCCESS: Verification runner correctly failed closed (exit code ${EXIT_CODE}) when worktree was dirty."
    echo "========================================================"
    exit 0
  else
    echo "❌ FAILURE: Verification runner did NOT fail closed on dirty worktree!" >&2
    exit 1
  fi
fi

echo "========================================================"
echo ">>> FACEBOOK AUTO-POSTER: CLEAN-WORKTREE VERIFICATION"
echo "========================================================"
COMMIT_HASH=$(git rev-parse HEAD)
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
echo "Repository: ${REPO_DIR}"
echo "Branch:     ${BRANCH_NAME}"
echo "Commit:     ${COMMIT_HASH}"
echo "Timestamp:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "========================================================"

# Step 1: Pre-run worktree cleanliness check
echo "[1/7] Checking for clean worktree before test execution..."
if [[ -n "$(git status --porcelain)" ]]; then
  echo "[ERROR] Working directory is not clean. Uncommitted changes detected:" >&2
  git status --short >&2
  exit 1
fi
echo "  -> Clean worktree confirmed."

# Step 2: Code Linting
echo "[2/7] Running ESLint code style and quality check..."
npm run lint
echo "  -> ESLint passed with 0 errors."

# Step 3: Encoding & Mojibake Check
echo "[3/7] Running UTF-8 encoding and mojibake prevention check..."
npm run check:encoding
echo "  -> Encoding check passed with 0 issues."

# Step 4: Database Safety Guard Tests
echo "[4/7] Running database safety guard and URL sanitizer tests..."
node tests/safety-guard.test.js
echo "  -> Safety guard unit tests passed."

# Step 5: Core Unit & Integration Tests
echo "[5/7] Running core security and regression test suite..."
npm test
echo "  -> Core test suite passed."

# Step 6: Headless Browser Tests
echo "[6/7] Running headless Chrome browser verification suite..."
node tests/browser-test.js
echo "  -> Browser integration tests passed."

# Step 7: PostgreSQL Multi-Tenancy & RBAC Suite
echo "[7/7] Running PostgreSQL multi-tenancy and security runner..."
npm run test:postgres
echo "  -> PostgreSQL tenancy suite passed."

# Post-run worktree cleanliness check
echo "Checking post-run worktree cleanliness..."
if [[ -n "$(git status --porcelain)" ]]; then
  echo "[ERROR] Test execution left modified or untracked files:" >&2
  git status --short >&2
  exit 1
fi
echo "  -> Post-run worktree remains completely clean."

echo "========================================================"
echo "✅ VERIFICATION SUCCESSFUL: ALL CHECKS & SUITES PASSED"
echo "Commit HEAD: ${COMMIT_HASH}"
echo "========================================================"
