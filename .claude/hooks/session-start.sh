#!/bin/bash
# Prepares a Claude Code cloud session: installs the repo's packages and, when the environment provides the club's
# clasp sign-in, writes it to ~/.clasprc.json so the desk can be pushed to /dev without a fresh login.
# The sign-in never touches the repository and is never printed: only "configured" or a generic problem is reported.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund --loglevel=error

CLASP_VERSION=3.4.1
if [ "$(clasp --version 2>/dev/null || true)" != "$CLASP_VERSION" ]; then
  npm install -g --no-audit --no-fund --loglevel=error "@google/clasp@$CLASP_VERSION"
fi

# CLASPRC_B64 is the base64 of a ~/.clasprc.json, set in the cloud environment's variables (never in this repo).
if [ -n "${CLASPRC_B64:-}" ]; then
  umask 077
  tmp="$(mktemp "$HOME/.clasprc.json.XXXXXX")"
  if printf '%s' "$CLASPRC_B64" | base64 -d > "$tmp" 2>/dev/null &&
     node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tokens; if(!t||!t.default||!t.default.refresh_token) process.exit(1)' "$tmp" 2>/dev/null; then
    mv "$tmp" "$HOME/.clasprc.json"
    chmod 600 "$HOME/.clasprc.json"
    echo "clasp sign-in configured from CLASPRC_B64."
  else
    rm -f "$tmp"
    echo "CLASPRC_B64 is set but is not a valid clasp sign-in; clasp is not signed in." >&2
  fi
fi
