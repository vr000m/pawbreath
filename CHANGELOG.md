# Changelog

User-visible changes are recorded here. Release dates record production deployment.

## 1.2.0 — 14 November 2026

Deployed build `aa881e199dc7`.

### Added

- History can replay each new timed reading at its recorded tap rhythm, or play visible readings newest first, one at a time. Playback is silent and works offline, with a static timeline, Stop control and reduced-motion support. Old and manual readings remain untimed.

- New timed readings retain individual accepted tap times in milliseconds. Backups stay format 2 until a reading has tap timing, so older app versions (1.1.0) can still restore them. A backup containing timing is format 3, which preserves it; older app versions reject format 3 backups, so do not roll back after recording timed readings. Restore imports formats 1, 2 and 3 without inventing timing.

- Dedicated counting view with a large stationary target, separate Undo/Cancel controls and optional quiet tap sounds. Background navigation is unavailable during a count; Escape cancels it. Single-finger movement on the target no longer scrolls the page, while pinch zoom remains available.

### Fixed

- The counting card keeps its bottom padding on short screens, and an update notice no longer flashes an empty box when a count ends.
- History no longer jumps when a replay starts, advances or ends: the replaying reading is highlighted without reflowing its text, and the replay detail keeps its space.
- Active Undo/Cancel controls stay below the counting target, including with bottom safe-area insets. Short screens can scroll outside the target without controls intercepting breath taps; idle Start stays pinned.
- The breath button shows a stable “Count one breath” label matching its accessible name, with the count exposed separately.
- Ticking Quiet tap sound now shows whether sound is actually available; if not, it says “Tap sound is not available on this device.” and unticks. Cancelling or finishing a count while that check is still running no longer unticks the box or replaces the count’s message.
- Tap sound recovers on the next taps after a call or other interruption during a count.
- Tap sound stops cleanly when a count ends or Quiet tap sound is unticked: a tone cut off by the end of a count no longer resumes at the start of the next one, and unticking releases the audio.
- An update notice that arrives during a count is announced to screen readers once the count ends.
- The finished count reads “breaths counted” again, and the counting instruction says “Tap the large area” instead of naming a colour.

## Deployed build 63316a30696f — 14 November 2026

These UI changes were deployed under version 1.1.0; no separate version bump was made.

### Changed

- Phone layout: Measure fits one screen with Start counting always reachable, the timer sits above the count circle, and the title steps aside while a count runs. History puts the dog picker and period on one row above the chart, with the context filter below it.
- The app opens on the dog you last chose, otherwise the dog with the newest reading, instead of the first dog alphabetically.
- Export CSV moved from History to Settings, next to the backup buttons, because it exports every dog.
- Tab bar uses drawn icons instead of text symbols, so they match on iPhone and Android.
- On phones an update notice that arrives during a count stays hidden until the count ends, to keep the counting area compact; screen readers still announce it.
- Short phone layouts hide optional duration/instruction controls during a count; very short layouts also hide the disabled dog picker. These changes alone did not prevent safe-area overlap, addressed in 1.2.0 above.
- History's "Enter a reading" button moved from above the chart to the "Recorded moments" heading, beside the list it adds to; Measure still has "Enter a previous reading".
- On wide screens the dog picker sits in the same place on Measure and History (left, under the heading), with the History period toggle beside it.
- Dog pickers match the other dropdowns (white, 16px, same height), so they no longer look disabled. Every form control is now at least 16px, which stops iPhone zooming the page when one is tapped.
- On phones the Measure and History subtitles are hidden, because the dog picker already names the dog; both pickers start at the same position.
- The manual-entry dialog keeps Save and Cancel visible while the form scrolls; the install steps are hidden once the app is installed, while the offline status stays.
- The note about waiting for settled sleep before a sleeping reading moved from the counter card into "Understanding a breathing reading".

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
