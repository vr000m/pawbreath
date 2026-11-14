# Changelog

User-visible changes are recorded here. Unreleased changes have not been deployed.

## Unreleased

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
