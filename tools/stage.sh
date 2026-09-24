#!/usr/bin/env bash
# Refresh the staging copy at brettboggs.dev/ked/ — the only place Jacob can
# see the site until kedservice.com moves. Builds the staging variant, drops it
# into the brettboggs.dev repo, commits and pushes; that repo's GitHub Action
# deploys it.
#
#   npm run stage              build, commit, push
#   npm run stage -- --no-push build and commit only
set -euo pipefail
cd "$(dirname "$0")/.."

SITE_REPO=${SITE_REPO:-../brettboggs.dev}
API=${PUBLIC_KED_API_URL:-https://ked-api.ked-api.workers.dev}
PUSH=1
[ "${1:-}" = "--no-push" ] && PUSH=0

[ -d "$SITE_REPO/.git" ] || { echo "No repo at $SITE_REPO"; exit 1; }
branch=$(git -C "$SITE_REPO" branch --show-current)
[ "$branch" = main ] || { echo "$SITE_REPO is on $branch, not main"; exit 1; }
# Only public/ked/ is ours to touch; anything else uncommitted there is Brett's.
if git -C "$SITE_REPO" status --porcelain | grep -v ' public/ked/' | grep -q .; then
  echo "$SITE_REPO has uncommitted changes outside public/ked/; leaving it alone."
  exit 1
fi

PUBLIC_KED_API_URL="$API" npm run build:staging >/dev/null
rsync -a --delete dist/ "$SITE_REPO/public/ked/"

sha=$(git rev-parse --short HEAD)
subject=$(git log -1 --format=%s)
git -C "$SITE_REPO" add -A public/ked
if git -C "$SITE_REPO" diff --cached --quiet; then
  echo "public/ked already matches $sha"
else
  git -C "$SITE_REPO" commit -q -m "Refresh the embedded KED build at $sha" -m "$subject"
  echo "committed staging refresh at $sha"
fi

if [ "$PUSH" = 1 ]; then
  git -C "$SITE_REPO" pull -q --rebase
  git -C "$SITE_REPO" push -q
  echo "pushed; brettboggs.dev/ked/ updates when its deploy finishes"
fi
