#!/usr/bin/env bash
# Store the Instagram token without it ever appearing in a command line,
# in shell history, or in a chat message. Paste at the prompt.
set -euo pipefail
cd "$(dirname "$0")/.."

printf 'Paste the long-lived Instagram token, then press Enter.\n> '
IFS= read -r token
token="${token//[$'\t\r\n ']/}"

if [ -z "$token" ]; then
  echo "Nothing entered. Aborted." >&2
  exit 1
fi

case "$token" in
  paste*|IGQWRPb3lk...*)
    echo "That is the example text, not a real token. Aborted." >&2
    exit 1 ;;
esac

if [ "${#token}" -lt 60 ]; then
  echo "That is only ${#token} characters. A long-lived token is normally 150+." >&2
  echo "Check you copied the value from 'Generate access token', not the App ID." >&2
  exit 1
fi

printf 'IG_TOKEN=%s\n' "$token" > tools/.env
chmod 600 tools/.env
echo "Saved ${#token} characters to tools/.env (gitignored, not printed)."
