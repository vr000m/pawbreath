# Recorded tap timing and History replay

**Status:** Implemented and desktop-verified; physical acceptance pending
**Component:** Pawbreath
**Assignee:** Codex
**Priority:** High
**Branch:** feature/breath-timing-replay
**Date:** 2026-11-14
**Objective:** Preserve individual accepted tap times and replay each History point, newest reading first.

## Context

The user approved per-tap timestamps and a pulsing History replay after Claude committed the counting fixes. Current timed records retain only count, duration and rate. Replay must show recorded taps, not an inferred evenly spaced breathing rhythm. Work starts from `52665642fb652a42b9a2099902bf75a92f4c3cbd` on a separate feature branch stacked on the counting work.

## Requirements

- Each new timed reading carries optional `tapOffsetsMs`, an array of integer milliseconds relative to the existing measurement-start `date`. Capture elapsed time from the monotonic measurement clock once per accepted click, floor to integer milliseconds, and retain initial/trailing silence using the full duration. Never record deadline/rejected taps. Undo removes the last offset; count always equals array length. Cancel discards the session; completion/save retry retains its exact array.
- Validate present timing arrays as timed-only, length equal to count, dense, nondecreasing (same millisecond allowed), integer, nonnegative and strictly below seconds × 1000. Copy the array at validation/save boundaries. Absence means unavailable; do not invent timings for manual/legacy readings or accept null as a valid trace.
- Store plain offset arrays in IndexedDB and JSON; this avoids repeated absolute timestamps without claiming two-byte packing in JSON. Keep IndexedDB schema 1: existing object stores need no migration. Export backup format 3 and accept formats 1/2/3; formats 1/2 remain untimed and reject a timing field. Older apps reject format 3; document that exporting through an old app can strip timing and that rollback after new recordings is unsupported. CSV remains the existing all-records summary; JSON is the timing-preserving format.
- App release becomes 1.2.0 (unreleased). No production deployment, merge, PR mutation or force-push in this task. Preserve Claude's counting/audio fixes.
- History offers a replay action per eligible reading and canvas-point selection, plus explicit “Replay newest first” for eligible visible readings of the selected dog. One reading at a time, newest to oldest by measurement date with deterministic ID tie-break; no automatic playback on page load and no synthetic replay for untimed readings. Keep chart x-axis chronological.
- Playback is visual and silent at original 1× speed. Advance to the next reading only after the full 30/60-second recording duration, including silent start/end gaps; do not simulate the days between readings. A soft ring highlights only the active point at its recorded taps. Late animation frames use elapsed time and never burst/replay overdue pulses. Stored millisecond precision does not promise millisecond screen refresh.
- Show the active reading's date, elapsed time/count and a static tap timeline. Label this recorded tap timing, not directly measured breathing. Reduced-motion users get a static selected point and timeline without pulsing. Accessible row buttons duplicate canvas interactions; announce reading transitions/Stop/completion, not every pulse.
- Stop or replace playback on explicit Stop/new replay, History filter/dog/data changes, page navigation, opening a form, starting a measurement, document hiding and pagehide. Resize redraws the current state without restarting or losing selection. Replay never mutates a reading or the recording audio state.

## Implementation checklist

### Phase 1: Capture and persistence

- Add the optional trace to the validator, current backup format and timed capture/Undo/completion paths. Preserve older records without the property and manual records as untimed. Update backup compatibility text and tests, retaining additive atomic restore and all-record CSV behavior.
- Bump package/lockfile to 1.2.0 without a tag. Keep previous plans as historical records; append only material backup/replay corrections and cross-links.

### Phase 2: Replay and History controls

- Add a small browser-independent replay controller with injected monotonic clock and frame callbacks, validated snapshot queue, deterministic newest-first selection, upper-bound lookup of elapsed taps, safe cancellation of stale callbacks and full-duration advancement.
- Add accessible per-row and visible-sequence controls, chart-point hit testing, active-point ring, status/progress and static timing canvas. Track points by reading ID, not chart index. Guard repeated renders and delayed callbacks; never call the recording sound helper during replay.
- Connect cleanup to existing lifecycle, filters, mutation refreshes and form entry. Keep reduced-motion changes responsive during playback.

### Phase 3: Verify and document

- Unit-test invalid traces, legacy/manual behavior, JSON version/restore round trips, FIFO capture/Undo invariants, irregular intervals, newest-first ordering, ties, initial/trailing gaps, delayed frames, replacement/stop and stale callbacks. Test queue selection excludes invalid/untimed records without changing chart/export data.
- Extend the exact-source browser harness for stored trace equality after real saves, failed saves, Undo/deadline/cancel, backup restore, per-point/list/sequence replay, all filter/data/page/modal/visibility cancellation paths, reduced motion and resize. Check 390×844 and 440×956 layouts and offline operation with a real worker.
- Add the module to precache and harness embedding, and syntax/import checks. Regenerate metadata after final app edits before tests/offline checks. Run npm test, browser harness and just deploy-check. Commit focused persistence, replay and documentation changes; no deployment. Regenerate and verify metadata for each source-changing commit; module imports, precache and harness wiring land together.

## Technical specifications

Explore verified count/click/Undo/completion in `dist/app.js:347–441`, the explicit record whitelist at `dist/data.mjs:62–84`, backup versions and normalization at `data.mjs:118–137`, existing schema-1 stores at `data.mjs:164–220`, and additive restore at `data.mjs:227–242`. History filters/rows and canvas points are owned by `app.js:177–279`; page/filter/form/visibility hooks already exist. The exact-source harness (`tests/browser-check.mjs:1–24`) embeds imported modules through checked substitutions. Worker installation checks every cached file digest (`dist/sw.js:1–39`). `package.json` declares Node >=22.12.0 and Wrangler 4.161.0; no new dependency is needed. These are planning-time locations; the base branch ref was verified at creation.

Modify `dist/app.js`, `dist/data.mjs`, `dist/app.css`, `dist/index.html`, `dist/sw.js`, `package.json`, `package-lock.json`, `tests/data.test.mjs`, `tests/browser-check.mjs`, and module checks in `tests/structure.test.mjs`. Add `dist/replay.mjs` and `tests/replay.test.mjs`. Regenerate `dist/version.mjs`, `dist/release.json` and worker digest lines. Update README/changelog, this plan and material decisions in sibling plans. This remains a single browser application; no server, separate worker logic or independently implemented storage service is introduced.

## Architecture & Call Flow

Accepted click → session offsets → completed pending record → `validateReading` copy → IndexedDB transaction → History filtered snapshot → replay controller → canvas/status. The app owns cancellation on navigation, filters, forms and lifecycle events; the controller owns frame scheduling and stale-callback rejection. The service worker independently serves verified cached assets, including the replay module; it never owns playback or journal data.

## Testing notes

A deterministic fake clock proves scheduling and cancellation; browser checks prove DOM/canvas integration and real IndexedDB/backup retention. Verify old timed and manual records remain visible/exportable and explain unavailable replay. Mutate caller arrays after validation, save initiation and replay initiation; verify persisted and replay snapshots remain unchanged. Test multiple dogs, same-date/same-rate points and filtered playback; overlapping chart points must have unambiguous row controls. Physical Safari, VoiceOver, installed-app updates and subjective pulse visibility on iPhone 12/17 Pro Max remain pending until device testing.

## Review focus

Lossless trace round-trip, count/length parity, strict version boundaries, no fabricated legacy timing; original-speed independent per-reading replay in newest-first order; no overdue-pulse bursts, stale animation callbacks or mutation of measurement data; reduced motion and accessibility.

## Acceptance criteria

- Saved new timed records and format-3 backups retain exactly the accepted offsets; undo/deadline/failure paths preserve count/trace parity. Legacy versions import without fabricated timings.
- Each selected point replays its own rhythm; visible sequence plays newest first, one full-duration recording at a time. Untimed/manual entries never pulse.
- All cleanup/reduced-motion/resize tests pass and no background callbacks keep playback alive after stopping.
- Full tests, browser checks and dry run pass; fresh offline reopening preserves replay data. Docs clearly distinguish recorded taps, compatibility constraints and pending physical checks.

<!-- reviewed: 2026-11-14 @ e83b491c90bab42452cd176883b83ae6be87325c -->

## Progress

Exploration and five-lens review plus contradiction pass complete. Three Important findings addressed: call flow, mutation-resistance tests and atomic commit metadata. Capture/persistence, History replay, documentation and desktop verification complete. Physical iPhone acceptance remains pending.

## Findings

Review: 3 raw / 3 unique / 0 merged / 0 related / 0 dropped; no contradictions. All three findings incorporated in the contract under the existing implementation authorization.

## Issues and solutions

A browser cannot render separate pulses for taps closer than a display frame; stored timing remains intact, and late frames must not manufacture a burst.

## Final results — 14 November 2026

Unreleased 1.2.0 build `b46ba9c9399c` (previously `24ef303881c6`; see the code-review fixes below), stacked on Claude's `5266564`. No deployment, merge, push or PR mutation.

- `npm test` and `just deploy-check`: 81 tests pass; metadata/syntax checks and Wrangler dry run pass. Browser harness: 26 checks pass, including save/restore timing equality, save failure/retry, caller mutation, per-point and newest-first replay, same-date points, context/export separation, resize, reduced motion and all cancellation paths.
- Real Chromium touch profiles at 390×844 and 440×956: a service-worker upgrade from 1.1.0 build `6379aad6d342` waits while a count/form is active. After closure, 1.2.0 retains the exact old journal. New recordings retain offsets including Undo, and replay after an offline reload. No browser errors; no horizontal overflow; replay controls are at least 44px tall. Screenshots inspected. These are emulations, not physical Safari checks.
- Invariant audit: the sole accepted-click path pushes one elapsed offset and derives count from array length; Undo pops and derives the same count. Completion copies the array. Validation copies before asynchronous IndexedDB work. Backup restore and replay both use that validator; the replay snapshot is frozen. A generation token rejects stale callbacks, and frames derive the current clip/tap directly from elapsed time. Only the active point receives a ring; playback never calls `tapSound.play()` or storage writes.
- Manual code/security/docs audit found no remaining blocking issue. No new dependencies, external destinations or credentials. The worker precaches and verifies the replay module. Rendering reuses a cached chart image instead of sorting/redrawing all history each frame. README/changelog and the baseline recovery correction match format 3 and unreleased status.

Physical checks remain pending on both iPhone 12 and iPhone 17 Pro Max: Safari and installed-app pulse visibility, toolbar/rotation and large text; VoiceOver replay labels/transitions/Stop; reduced-motion behavior; real background/lock cancellation; installed-app upgrade and offline reopening. Original tap accuracy and recording-audio acceptance remain as documented in the focused-counting plan.

### Code-review fixes (14 November 2026)

- The backup timing gate now accepts timing from format 3 onward instead of only the current format, so a later format bump cannot reject format 3 backups.
- Chart hit targets and **Replay newest first** use the list History last rendered and validated, so a stored trace that fails validation has no chart target, and a replay never re-filters by a later clock.
- Per-frame work is skipped when nothing changed (progress text, identical ring), and focus returns to **Replay newest first** when Stop is disabled. The CSV-equality test now compares a real untimed record.
- Not changed: timing is captured when the click handler runs, not from the event timestamp; additive restore cannot add timing to an existing untimed record with the same ID.
