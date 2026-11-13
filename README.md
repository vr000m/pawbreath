# Pawbreath

A mobile-first breathing journal for dogs. The app supports timed 30/60-second tap counting, multiple dog profiles and photos, notes, date-filtered charts, owner-entered thresholds, CSV export, and versioned JSON backups.

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

## Current delivery state

Source implementation and Node checks are complete. Live browser verification and iPhone installation remain unverified. The execution environment denied the local HTTP listener, blocked local-file browser navigation, and could not resolve the hosting Git endpoint.

A private Site was registered as `appgprj_6af61d3c75548191a87ab70dbd1291b0`, with its identity saved in `.openai/hosting.json`. No version was deployed. Resume publication with this existing Site identity when network access is available.

The app now lives in the standalone [Pawbreath repository](https://github.com/vr000m/pawbreath), moved from `tinkerbox/www/pawbreath`. Run the commands above from this repository's root. Git tracks `dist/` as app source and `.openai/hosting.json` as hosting configuration; local credentials, editor state and verification output are ignored.
