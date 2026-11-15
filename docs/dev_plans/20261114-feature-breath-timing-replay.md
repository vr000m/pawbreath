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
- Store plain offset arrays in IndexedDB and JSON; this avoids repeated absolute timestamps without claiming two-byte packing in JSON. Keep IndexedDB schema 1: existing object stores need no migration. Export the lowest backup format able to hold the snapshot (format 2 without timing, format 3 once any reading has a trace; owner decision 2026-11-14, superseding "export format 3") and accept formats 1/2/3; formats 1/2 remain untimed and reject a timing field. Older apps reject format 3; document that exporting through an old app can strip timing and that rollback after new recordings is unsupported. CSV remains the existing all-records summary; JSON is the timing-preserving format.
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

Modify `dist/app.js`, `dist/data.mjs`, `dist/app.css`, `dist/index.html`, `dist/sw.js`, `package.json`, `package-lock.json`, `tests/data.test.mjs`, `tests/browser-check.mjs`, and module checks in `tests/structure.test.mjs`. Add `dist/replay.mjs` and `tests/replay.test.mjs`; round 3 part 2 adds `dist/history-chart.mjs` and `tests/history-chart.test.mjs`. Regenerate `dist/version.mjs`, `dist/release.json` and worker digest lines. Update README/changelog, this plan and material decisions in sibling plans. This remains a single browser application; no server, separate worker logic or independently implemented storage service is introduced.

## Architecture & Call Flow

Accepted click → session offsets → completed pending record → `validateReading` copy → IndexedDB transaction → History filtered snapshot → replay controller → history chart (canvas)/app status text. The app owns cancellation on navigation, filters, forms, lifecycle events and DOM text/focus; the controller owns frame scheduling and stale-callback rejection; `history-chart.mjs` owns chart drawing, point layout/hit-testing, the replay ring and tap timeline, and the current replay frame. The service worker independently serves verified cached assets, including the replay module; it never owns playback or journal data.

## Testing notes

A deterministic fake clock proves scheduling and cancellation; browser checks prove DOM/canvas integration and real IndexedDB/backup retention. Verify old timed and manual records remain visible/exportable and explain unavailable replay. Mutate caller arrays after validation, save initiation and replay initiation; verify persisted and replay snapshots remain unchanged. Test multiple dogs, same-date/same-rate points and filtered playback; overlapping chart points must have unambiguous row controls. Physical Safari, VoiceOver, installed-app updates and subjective pulse visibility on iPhone 12/17 Pro Max remain pending until device testing.

## Review focus

Lossless trace round-trip, count/length parity, strict version boundaries, no fabricated legacy timing; original-speed independent per-reading replay in newest-first order; no overdue-pulse bursts, stale animation callbacks or mutation of measurement data; reduced motion and accessibility.

## Acceptance criteria

- Saved new timed records and format-3 backups (written once any reading is timed) retain exactly the accepted offsets; undo/deadline/failure paths preserve count/trace parity. Legacy versions import without fabricated timings.
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

Unreleased 1.2.0 build `aa881e199dc7` (previously `e9024750af83`, `4394d50f4e8a`, `7725cd92909e`, `eb51348c2b52`, `c16a4ce624d5`, `edf79fb91c75`, `b46ba9c9399c` and `24ef303881c6`; see the code-review fixes, layout follow-up and review-gauntlet rounds 1 to 6, round 3 part 2 included, below), stacked on Claude's `5266564`. No deployment, merge, push or PR mutation.

- `npm test` and `just deploy-check`: 104 tests pass; metadata/syntax checks and Wrangler dry run pass. Browser harness: 30 checks pass (a pending tap-sound check survives an idle reset by refresh, duration or dog select; the replay check now also asserts stable layout; the untick check covers audio release; a same-date check asserts History list order equals replay order; a tap-sound check still pending when a count ends keeps the box and message; chart redraws keep the rendered readings), including save/restore timing equality, save failure/retry, caller mutation, per-point and newest-first replay, same-date points, context/export separation, resize, reduced motion and all cancellation paths.
- Real Chromium touch profiles at 390×844 and 440×956: a service-worker upgrade from intermediate build `6379aad6d342` (reporting 1.1.0) waits while a count/form is active. After closure, 1.2.0 retains the exact old journal. New recordings retain offsets including Undo, and replay after an offline reload. No browser errors; no horizontal overflow; replay controls are at least 44px tall. Screenshots inspected. These are emulations, not physical Safari checks.
- Invariant audit: the sole accepted-click path pushes one elapsed offset and derives count from array length; Undo pops and derives the same count. Completion copies the array. Validation copies before asynchronous IndexedDB work. Backup restore and replay both use that validator; the replay snapshot is frozen. A generation token rejects stale callbacks, and frames derive the current clip/tap directly from elapsed time. Only the active point receives a ring; playback never calls `tapSound.play()` or storage writes.
- Manual code/security/docs audit found no remaining blocking issue. No new dependencies, external destinations or credentials. The worker precaches and verifies the replay and history-chart modules. Rendering reuses a cached chart image instead of sorting/redrawing all history each frame. README/changelog and the baseline recovery correction match the format 2/3 export rule and unreleased status.

Physical checks remain pending on both iPhone 12 and iPhone 17 Pro Max: Safari and installed-app pulse visibility, toolbar/rotation and large text; VoiceOver replay labels/transitions/Stop; reduced-motion behavior; real background/lock cancellation; installed-app upgrade and offline reopening. Original tap accuracy and recording-audio acceptance remain as documented in the focused-counting plan.

### Code-review fixes (14 November 2026)

- The backup timing gate now accepts timing from format 3 onward instead of only the current format, so a later format bump cannot reject format 3 backups.
- Chart hit targets and **Replay newest first** use the list History last rendered and validated, so a stored trace that fails validation has no chart target, and a replay never re-filters by a later clock.
- Per-frame work is skipped when nothing changed (progress text, identical ring), and focus returns to **Replay newest first** when Stop is disabled. The CSV-equality test now compares a real untimed record.
- Not changed: timing is captured when the click handler runs, not from the event timestamp; additive restore cannot add timing to an existing untimed record with the same ID.

### Replay layout follow-up (14 November 2026)

- The replaying row is marked by an inset bar and tint inside its existing padding (no `padding-left`), so its text never reflows. `#replay-status`/`#replay-progress` reserve one line and `#replay-detail` keeps its space, hidden with `visibility` plus `aria-hidden`/`inert` while inactive. The harness asserts the list heading's offset and the row's text box are identical before, during, after Stop and after a finished sequence; reverting the CSS fails it.
- The counting session no longer stores `count`; every read derives it from `tapOffsetsMs.length`. `scrollIntoView` drops the `behavior` option for older Safari.

### Review-gauntlet round 1 (14 November 2026)

- `tapSound.stop()` now stops and disconnects every tone still playing before suspending. Previously a tone cut off by the end of a count stayed connected in the suspended context and resumed at the start of the next count. `stop()` stays idempotent (count end, cancel, untick).
- Unticking **Quiet tap sound** calls `tapSound.stop()`, so the context started by the tick is suspended. The bumped attempt counter still makes a pending `detect()` ignore its result.
- `newestFirst` is the single reading order (moved from `replay.mjs` to `data.mjs` in round 2) (newest first, then id by code unit). The replay queue, chart hit-test tie-break and History list all use it.
- Tests: a table over {unticked, ticked-idle, counting, finished} × {suspended, running} × {tone, none} for `stop()`, the 10 ms-before-end case, and a harness check that unticking suspends audio when detect has finished, is pending, or follows a count. Each failed with its fix reverted.

### Review-gauntlet round 2 (14 November 2026)

- `newestFirst` now lives in `data.mjs` with the other reading rules; `app.js` (History list, chart hit-test) and `replay.mjs` (replay queue) import it from there, so the History list no longer depends on the replay module to sort.
- `tap-sound.mjs` keeps each playing tone as a `{ stop, disconnect }` object in a `tones` set instead of a function carrying a `.stop` property. Behaviour is unchanged.
- The structure test's regex guard against a second comparator is replaced by a harness check: with same-date readings stored out of order, the History list order equals the `replayableReadings` order and the order Replay newest first actually plays. The structure test keeps only the import assertion; a unit test covers `newestFirst` over equal dates, equal ids, different ids and different dates, and another asserts `stop()` ends every tone and a late `onended` is harmless.
- Mutation checks: giving the History list its own reversed tie-break fails only the new harness check; moving `newestFirst` back to `replay.mjs` fails the data and structure tests.

### Review-gauntlet round 3 (14 November 2026)

- Every app-level stop of tap audio goes through `stopTapSound()`, which bumps the `detect()` attempt counter before `tapSound.stop()`. Previously a count ending (cancel, finish, zero-tap finish, open failure) suspended audio while a tick's `detect()` was still pending; the check then read that suspend as unavailable, unticked the box and replaced the count's message. Now a count ending supersedes the pending check: the box stays ticked and the next count attempts sound. A result arriving idle or mid-count still reports the device.
- `drawChart()` draws from `visibleReadings`, the list History last rendered, instead of filtering again by `Date.now()`. A resize redraw near a period's edge no longer drops a listed reading from the chart and its hit targets.
- `#counting-dialog` rules win over phone rules by specificity, which the phone-order guard does not check; a comment in `app.css` and in `tests/structure.test.mjs` records this. README states restore accepts versions 1, 2 and 3 and that untimed readings are skipped by Replay newest first.
- Tests: a harness table over {ticked, unticked} × {detect settles idle, during the count, after cancel, after finish, after a zero-tap finish} × {audio available, unavailable}, checking box, status, one count per tap and whether the next count sounds; a harness check that a resize after the 7-day edge passes keeps chart points equal to the rendered list; a unit test that `replayableReadings` returns `newestFirst` order for every input rotation. Each failed with its fix reverted.

### Review-gauntlet round 3, part 2 (14 November 2026)

- **Owner decision, 2026-11-14:** exports write the lowest format able to hold the snapshot: format 2 when no reading carries `tapOffsetsMs`, format 3 when at least one does. This overrides the earlier line that every new export uses format 3, which made installs on 1.1.0 reject every backup from an updated phone even when it held nothing they could not read. Import still accepts 1, 2 and 3, and a v1/v2 file carrying timing is still rejected. `validateBackup` reports that same version, so `makeBackup` and `validateBackup` stay a round-trip pair.
- **Owner decision, 2026-11-14:** chart drawing, point layout and hit-testing, the replay ring and the tap timeline moved from `app.js` into `dist/history-chart.mjs`, which takes the chart and timeline canvases, keeps the current replay frame, the cached chart image and its points, and touches no other DOM. `app.js` keeps the wiring: text/aria, buttons, focus and call sites. Behaviour is unchanged: replay, chart click, resize redraw, reduced motion, stable layout and chart points from the rendered `visibleReadings`.
- Tests: a data table over {no timed readings, mixed, all timed, empty journal} x {v1, v2, v3 import} checks the export version, round trip, that 1.1.0's gate and field whitelist accept every format 2 export, and that the timing gate still rejects v1/v2 files with traces. Unit tests cover the chart layout, hit-test radius and newestFirst tie-break over every rotation, ring pulse and the module's own replay state. Forcing version 3 fails four data tests; reversing the hit-test tie-break fails the hit-test test. The browser harness (30 checks) is unchanged apart from reading `historyChart.points` and `historyChart.replay` in place of the old app variables. Mid-replay History screenshots at 390px and 1280px are byte-identical before and after the move. The owner's 2026-11-14 backup (format 2, 2 dogs, 1 reading) still validates and re-exports as format 2.

### Review-gauntlet round 4 (14 November 2026)

- The replay controller now exposes `active`, the one record of whether playback runs: true from a successful `start()` until `stop()`, replacement, an empty start or the natural end (already false when `onEnd` runs). `app.js` asks `replay.active` instead of reading `historyChart.replay`; the chart module only paints the frames it is given. `onEnd` calls `clearReplay()` directly. Behaviour is unchanged.
- `data.mjs` `VERSION` is renamed `NEWEST_READABLE_VERSION`; `READABLE_VERSIONS` and the import error text are built from it, so the accepted set is written once. Exports still write format 2 or 3 by the owner rule.
- The structure tests derive the module set from the shell's import graph plus the precache list instead of hand lists, so `tap-sound.mjs` (and any new module) gets the import check, and the precache must equal the shell graph in both directions.
- `leaveCountingView()` stops tap audio only when a count view was actually open. Previously every `resetCounter()` (refresh from another tab or on return to the page, a duration button, the dog select) bumped the tap-sound check and suspended audio, so a tick's pending check was dropped: the box stayed ticked and no status appeared. A count ending (finish, cancel, zero-tap finish, open failure) still supersedes the check and releases audio.
- Tests: a unit test for `active` across start, frames, natural end, stop, replacement and empty starts; a structure guard that `app.js` reads `replay.active` and not `historyChart.replay`; harness replay checks assert controller and chart agree; the round-3 tap-sound table gains {pending, settled} x {idle reset by refresh(), duration button, dog select} cells for both box states and both audio outcomes; a data test for the readable-version set and message. Mutations: deriving `active` from the frame id, or reading `historyChart.replay` in `app.js`, fails the new unit/structure tests; routing `onEnd` back through the guarded stop fails the harness replay check; restoring the unconditional stop fails the first idle-reset cell; an orphan precached module with a bad import, or dropping the `tap-sound.mjs` import, passes the old structure tests and fails the new ones. `npm test` (97), `just deploy-check` and the browser harness (30 checks) pass.

### Review-gauntlet round 5 (14 November 2026)

- The tap-timing import error is built from `TIMING_VERSION` (now exported) like the readable-version message, so no version number is hand-written in a `data.mjs` message.
- `historyChart.setReplay` is a plain setter. `app.js` keeps `renderedReplayId` and writes the status, row cue, Stop button, detail and timeline when the frame's reading differs from it; `clearReplay()` resets it. Previously `app.js` drove that from `setReplay`'s return value, so the paint module owned a UI signal. Behaviour is unchanged.
- The structure test and the browser harness share one import parser (`scripts/lib/import-graph.mjs`). The harness keeps its hand-ordered inlining (dependency order matters in one scope) but fails to build when its inlined set differs from the modules `app.js` reaches, when an import/export line survives, or when two inlined pieces (modules, `app.js`, worker stub, checks) declare the same top-level name; duplicate functions would otherwise silently override. Chosen over deriving the order because it is the smaller change and still makes drift fail loudly.
- Docs: README lists every replay stop trigger (data changes and starting a measurement were missing); the baseline plan's recovery line points to the 2026-11-14 format sections.
- Tests: a data test that the timing message names `TIMING_VERSION` and no `data.mjs` string literal hard-codes a version; a structure guard that `app.js` calls `setReplay` only as a statement; the chart unit test expects no return value; the harness replay check writes sentinels between frames and asserts same-reading frames leave status/Stop/aria/row/timeline alone, a reading change writes them once, and replaying the same reading after Stop renders it again. Mutations: restoring the `version 3` literal fails the data test; using `setReplay`'s result fails the structure and chart tests; rendering on every frame, or not resetting on clear, fails the harness check; dropping `tap-sound.mjs` from the inlined set or adding a colliding top-level name stops the harness build (and so `npm test`). `npm test` (99), `just deploy-check` and the browser harness (30 checks) pass. No user-visible change, so no changelog entry.

### Review-gauntlet round 6 (14 November 2026)

- Root cause: the harness collision guard decided "top level" by text column, not by scope, so an indented top-level declaration (for example ` function respiratoryRate() {}` appended to `history-chart.mjs`) escaped it and silently replaced `data.mjs`'s function in the one shared harness scope. The guard now lives in `scripts/lib/top-level-names.mjs` and asks V8: it compiles, never runs, each piece inside an async function followed by `let` of every identifier-like word in the piece; each "already declared" error names one top-level name. That covers every declaration form, multiple declarators and destructuring included (so the round-5 "form it cannot read" rejection is gone), and ignores nested scopes, strings, comments, templates and regexes. Limits: each piece must parse on its own inside an async function; sloppy-mode Annex B hoisting of a function declared inside a block is not reported.
- Docs: README's replay stop list adds confirmation dialogs (deleting a reading stops playback even if cancelled). CHANGELOG has no stop list, so it is unchanged.
- Tests: unit tests for indented function/async/generator/class/const/let/var, multiple and destructured declarators and block `var`; nested, string, comment, template and regex declarations not reported; same name in two pieces flagged, nested-only not; the reviewer's repro on the real `data.mjs`/`history-chart.mjs`; and a guard that the harness calls the shared check. Mutations: restoring the column-zero regex fails three tests; dropping the harness call fails the wiring test. The repro appended to `dist/history-chart.mjs` stops the harness build. `npm test` (104), `just deploy-check` and the browser harness (30 checks) pass. No user-visible change, so no changelog entry.

