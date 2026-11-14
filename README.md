# Pawbreath

A mobile-first breathing journal for dogs: timed 30/60-second counts, multiple profiles and photos, manual entries, measurement context, notes, history charts and backups. Each browser keeps its own journal; there are no accounts or sync across devices.

![Pawbreath measurement screen with a sample Milo profile and latest reading](docs/images/pawbreath-preview.png)

Local preview with sample data. See the [changelog](CHANGELOG.md) for changes and the [development plan](docs/dev_plans/20261112-feature-pawbreath.md) for decisions and verification. Unreleased changes (see the changelog) are not yet deployed; physical iPhone acceptance remains pending.

## Install and use

On iPhone, open the hosted HTTPS site in Safari and choose **Share → Add to Home Screen**. On Android, use **Install app** or **Add to Home screen**. Open online once and check for **Offline ready** before relying on offline loading.

Add a dog, wait until they are settled or asleep, and start a count. Tap once per breath, review the result, then save. Leaving the app cancels an active count; zero-breath counts cannot be saved. Failed saves retain the result for retry. Manual entries record a rate and original local date/time without inventing a count or duration; future dates and years before 1970 are rejected.

Readings can be labelled asleep, resting, restless or context not recorded, with an optional uncertainty flag. History applies date/context filters to both chart and list. Saving an entry clears conflicting filters so it stays visible. Profiles are editable; reading deletion asks for confirmation.

The cached breathing guidance explains measurement context and when to seek veterinary advice. Thresholds start blank: enter the value your vet recommends. The general 30 breaths/min reference never sets that value automatically. The app compares readings against the entered threshold without diagnosing a condition. External source links require connectivity.

## Storage and backups

Data stays in IndexedDB on this device/browser and hostname. The last-chosen dog is remembered per browser; readings stay in IndexedDB only. Clearing browser data or losing the device can lose the journal. Download JSON backups from Settings regularly. Export CSV sits beside them in Settings; CSV exports include all dogs and readings with UTC timestamps, regardless of History filters.

Restore validates the complete backup and adds missing records in one transaction, preserving existing records with matching IDs. A previous backup can recover deleted readings. Export and restore share validation rules and have no fixed aggregate size/count limit; browser resources still limit capacity.

New backups use format 2 and accept version 1 imports. Older app versions cannot import format 2. Manual records retain their source, context and uncertainty; CSV leaves their count/duration fields blank. Version 1.0 cannot export backups containing 1.1.0 manual records, so before rolling back export a backup from 1.1.0, and do not roll back while manual entries are present.

## App updates

Settings shows running/published versions, the last successful check and **Check for updates**. Checks also run on launch, reconnection and resumption. **Offline ready** means the app is cached, not necessarily current.

When **Update ready** appears (on a phone it stays visually hidden until a running count ends; screen readers still announce it), save your work, fully close the installed app and all Pawbreath browser tabs, then reopen. Downloaded updates can activate offline and retain the journal. They never force a reload during a count or form edit. Unsaved work does not survive intentionally closing the app. Older releases gain the version panel only after completing this upgrade cycle.

## Develop and verify

The tracked `dist/` directory is the app source; no runtime build or package installation is needed for a basic preview:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory dist
```

Open <http://127.0.0.1:8766>. Use localhost HTTP or hosted HTTPS for service workers.

With Node.js 22.12+ and [just](https://github.com/casey/just):

```sh
just install        # Install locked development dependencies
just dev            # Workers preview on port 8766; accepts another port
npm test            # Node tests, release metadata and syntax checks
node tests/browser-check.mjs
just deploy-check   # Tests and Wrangler dry run; does not deploy
```

Open the browser harness's printed file to run its checks. It uses an isolated database and simulated worker registration. Actual worker upgrades require a served test; iPhone installation and lifecycle checks require the device.

`package.json` owns the release version. To change it, use `npm version 1.1.1 --no-git-tag-version` with the intended version. Run `npm run release` after final app edits, then commit the changed source, package/lockfile and generated `dist/version.mjs`, `dist/release.json` and `dist/sw.js`. Tests reject stale metadata. App, backup and database versions are independent.

## Deploy to Cloudflare

[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) serves `dist/` at `pawbreath.com`, with no server-side journal or runtime secrets. The site is public; visitors see only their own browser's data.

```sh
just cf-whoami      # Check authentication
just deploy        # Tests, authentication, then production deployment
```

Keep credentials outside the repo. These commands load `~/.secrets/cf.env` when no `CLOUDFLARE_API_TOKEN` is exported. Use shell assignments for that token and `CLOUDFLARE_ACCOUNT_ID`. An explicit `CLOUDFLARE_ENV_FILE=/absolute/path/to/file.env` overrides exported credentials; otherwise Wrangler can use its existing login. Preview and dry runs do not load this file.

Deployment requires a clean tracked `dist/`, including no ignored/untracked files: everything there can become public. Wrangler manages the apex custom domain; Cloudflare's dashboard separately manages HTTP/`www` redirects to HTTPS apex, preserving paths/queries. Keep the `www` placeholder A record (`192.0.2.0`) proxied and the redirect enabled. `dist/_headers` sets the security policy and cache controls. The host must serve shell files byte-for-byte (no HTML rewriting, minification or injection); the service worker verifies each file's SHA-256 at install, so any change makes installation fail and offline mode will not activate. After deployment, verify HTTPS, redirects, offline reopening and the installed app.
