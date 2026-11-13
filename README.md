# Pawbreath

A mobile-first breathing journal for dogs. The app supports timed 30/60-second tap counting, multiple dog profiles and photos, notes, date-filtered charts, owner-entered thresholds, CSV export, and versioned JSON backups.

![Pawbreath measurement screen with a sample Milo profile and latest reading](docs/images/pawbreath-preview.png)

Local browser preview with sample data.

## Run locally

From this directory, start a static server.

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8766>. The app has no package installation or build step. Use HTTP on localhost or HTTPS when hosted, because browser modules, service workers, and home-screen installation need the appropriate origin.

To install on an iPhone, open the hosted HTTPS URL in Safari, choose Share, then Add to Home Screen. On Android, use the browser's Install app or Add to Home screen action. Open the app online once and check that it reports “Offline ready” before relying on offline loading.

## Storage and measurement behavior

- Each device/browser keeps its own IndexedDB journal. Data does not synchronize across people or devices.
- Download JSON backups from Settings to protect readings against device loss or clearing browser data. CSV exports include all dogs and use UTC timestamps.
- Restore validates the complete backup before beginning one transaction. It adds missing IDs and keeps existing records on conflicts. A previous backup can restore a reading deleted since that backup.
- Backups have no fixed record-count or file-size limit. Export and restore validate the same format and record rules; available browser memory and device storage limit how large a journal can be processed.
- Each measurement starts with an explicit Start action. Taps at or after the deadline do not count. Zero-breath sessions cannot be saved. Leaving the app during a count cancels that measurement.
- Save confirms only after the database transaction commits. A failed save retains the completed reading for retry.
- Thresholds start empty. Enter the value your vet recommends. The app displays a comparison at or above that value.
- Profiles can be edited. Individual readings can be deleted after confirmation. Dog deletion and cloud accounts are outside this version's scope.
- Service-worker updates wait until all existing app windows close. Increment `CACHE` in `dist/sw.js` whenever shipping changed shell assets.

## Verify

```sh
node --test tests/*.test.mjs
node --check dist/app.js
node --check dist/data.mjs
node --check dist/sw.js
```

An optional browser harness combines the current source into a temporary HTML file and uses a separate test database. It exercises real IndexedDB writes, aborted commits, import rollback, concurrent connections, duplicate restores, hostile text, timer boundaries, and interrupted sessions.

```sh
node tests/browser-check.mjs
```

Open the printed temporary file in a browser to run it. The title and an on-page report show its results. Test databases use `pawbreath-verification-*` names. The harness does not test service workers. For a served browser check, also verify the 375px mobile layout, offline reload, install-to-home-screen flow, and a worker update while a count is running.

## Cloudflare Workers

Deploy the static app to `pawbreath.com` using [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/). The Wrangler configuration uploads only `dist/` and attaches the apex domain. There is no app build step or server-side database. Journal data stays in the browser, and each hostname has its own journal storage.

Install Node.js 22.12+ and [just](https://github.com/casey/just), then run:

```sh
just install        # Install the locked Wrangler development dependency
just dev            # Local Workers preview at http://127.0.0.1:8766
just test           # Full Node suite and syntax checks
just cf-whoami      # Read-only account/authentication check (JSON)
just deploy-check   # Tests and a local deployment dry run
just deploy         # Tests, authentication check, then production deployment
```

Use `just dev 8767` if the default port is already occupied.

`just cf-whoami` and `just deploy` load `~/.secrets/cf.env` if `CLOUDFLARE_API_TOKEN` is not already exported. The file should contain shell-compatible assignments for `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. To use another file, set `CLOUDFLARE_ENV_FILE=/absolute/path/to/file.env`; relative paths (including bare names and `~` left unexpanded) are rejected. An explicit file override takes precedence over exported credentials; an unreadable override fails immediately. Without a file or exported token, Wrangler uses its existing login (`./node_modules/.bin/wrangler login`). Local preview and dry runs do not load the external credential file.

Deployment is expected to need a token scoped to the target account with Workers Scripts edit access, plus Zone read and Workers Routes write access for `pawbreath.com` ([Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)). These scopes are unverified: creating the custom domain may also need DNS edit, so adjust the token if the first `just deploy` is rejected. The domain must be an active Cloudflare zone in that account, and the apex must have no existing A, AAAA or CNAME record, or custom-domain creation will fail. The deployment config creates the custom-domain association and disables `workers.dev` and preview URLs. It does not configure `www.pawbreath.com`. After deployment, verify HTTPS, offline reload and home-screen installation at the final hostname.

Keep credential files outside the repository. `.env*`, `.dev.vars*`, `.openai/`, `node_modules/` and `.wrangler/` are ignored. The runtime site does not need any Cloudflare credentials.

## Current delivery state

Source implementation, all 20 Node tests and the 11-check Chromium browser harness pass. The local preview also fits a 375px mobile viewport without horizontal overflow. Real-device installation, a two-version service-worker update during a count, and deployment remain unverified.

A private Site was originally registered, with its identity saved locally in the ignored `.openai/hosting.json` file. Cloudflare Workers is now the deployment target; the Sites identity is retained locally but is not used by the recipes above. No production deployment has been performed.

The app now lives in the standalone [Pawbreath repository](https://github.com/vr000m/pawbreath), moved from `tinkerbox/www/pawbreath`. Run the commands above from this repository's root. Git tracks `dist/` as app source; local hosting configuration in `.openai/`, credentials, editor state and verification output are ignored.
