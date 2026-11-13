# Keep Wrangler logs with its ignored local state.
export WRANGLER_LOG_PATH := ".wrangler/logs/"

# List available commands.
default:
    @just --list

# Install the pinned deployment tools (Node.js 22+ required).
install:
    npm ci

# Preview with the local Workers runtime; no credentials required.
dev port="8766":
    ./node_modules/.bin/wrangler dev --ip 127.0.0.1 --port {{quote(port)}}

# Run all Node tests and JavaScript syntax checks.
test:
    npm test

# Verify Cloudflare authentication using external credentials or Wrangler login.
cf-whoami:
    bash scripts/cloudflare.sh whoami

# Validate the deployment bundle without uploading or changing DNS.
deploy-check: test
    ./node_modules/.bin/wrangler deploy --dry-run --outdir .wrangler/deploy

# Publish the app and configure the pawbreath.com custom domain.
deploy: test
    bash scripts/cloudflare.sh deploy
