# Changelog

User-visible changes are recorded here. Unreleased changes have not been deployed.

## Unreleased

### Changed

- Phone layout: Measure fits one screen with Start counting always reachable, the timer sits above the count circle, and the title steps aside while a count runs. History puts the dog picker and period on one row above the chart, with the context filter below it.
- The app opens on the dog you last chose, otherwise the dog with the newest reading, instead of the first dog alphabetically.
- Export CSV moved from History to Settings, next to the backup buttons, because it exports every dog.
- Tab bar uses drawn icons instead of text symbols, so they match on iPhone and Android.
- The manual-entry dialog keeps Save and Cancel visible while the form scrolls; the install instructions are hidden once the app is installed.

### Fixed

- The History page has its own dog picker, shared with Measure, so a dog's readings are no longer hidden behind a selector that only existed on another page.

## 1.1.0 — 14 November 2026

### Added

- Manual readings with the original measurement time, context, uncertainty and notes; no invented count or duration.
- Context and uncertainty labels for timed readings, with matching History chart/list filters.
- Sourced breathing guidance available offline. Its general reference never supplies the optional vet threshold.
- Settings version/build display, update checks and instructions for safely reopening a downloaded update.

### Changed

- JSON backup format 2 retains source, context and uncertainty; format 1 remains importable. Older app versions cannot import format 2. The device database schema remains unchanged. Version 1.0 cannot export backups containing 1.1.0 manual records; export from 1.1.0 before any rollback, and do not roll back while manual entries are present.
- CSV includes the new fields, leaves manual count/duration blank, and exports all records regardless of History filters.

### Fixed

- Saving an older or differently labelled reading clears filters that would hide it.
- Manual entry rejects future dates, years before 1970 and rates above 300 breaths/min. Failed saves and repeated Escape preserve dirty manual drafts until saved or discarded.
- Update checks retain counts and unsaved work while downloaded workers wait for all app windows to close.
- Release checks reject stale generated metadata; worker installation checks the build ID in `version.mjs` and verifies every precached shell file against the SHA-256 `DIGESTS` manifest generated into `sw.js`; any mismatch aborts installation and caches nothing. Build hashing handles nested files and ignores dotfiles.

## Earlier baseline

The previously deployed app provides dog profiles/photos, 30/60-second timed counts, history, owner-entered thresholds, CSV export, JSON backup/restore and an offline shell. Hosting uses Cloudflare Workers with HTTPS/apex redirects.
