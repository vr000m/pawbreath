#!/usr/bin/env bash
set -euo pipefail
set +x

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

case "${1:-}" in
  whoami|deploy) ;;
  *) echo "Usage: bash scripts/cloudflare.sh {whoami|deploy}" >&2; exit 2 ;;
esac

# Explicit credentials already in the environment take precedence over the default file.
# An explicit file override is always loaded; fail if that path is missing or unreadable.
cf_env_file="${CLOUDFLARE_ENV_FILE:-}"
if [[ -z "$cf_env_file" && -z "${CLOUDFLARE_API_TOKEN:-}" && -f "$HOME/.secrets/cf.env" ]]; then
  cf_env_file="$HOME/.secrets/cf.env"
fi
# Only absolute paths are unambiguous: this script cd's to the repo root, and `source` searches
# PATH for names without a slash.
if [[ -n "$cf_env_file" && "$cf_env_file" != /* ]]; then
  echo "CLOUDFLARE_ENV_FILE must be an absolute path (got '$cf_env_file')." >&2
  exit 2
fi
if [[ -n "$cf_env_file" ]]; then
  set -a
  source "$cf_env_file"
  set +a
fi

wrangler=./node_modules/.bin/wrangler
if [[ ! -x "$wrangler" ]]; then
  echo "Wrangler is missing. Run 'just install' first." >&2
  exit 1
fi

# JSON mode exits non-zero when unauthenticated; human-readable mode may not.
if [[ "$1" == whoami ]]; then
  exec "$wrangler" whoami --json
fi
"$wrangler" whoami --json > /dev/null
exec "$wrangler" deploy
