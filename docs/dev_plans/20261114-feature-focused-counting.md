# Focused counting while watching the dog

**Status:** Implemented and desktop-verified; physical acceptance pending
**Component:** Pawbreath
**Assignee:** Codex
**Priority:** High
**Branch:** fix/iphone-counting-layout
**Date:** 2026-11-14
**Objective:** Make deliberate breath taps easier to register without looking at the screen.

## Context

A user reported missed counts while watching their dog. The cause on that device is unconfirmed. The preceding [layout fix](20261114-bug-iphone-counting-layout.md) prevents Undo overlap, but keeps a small circular target. The user approved a larger stationary active surface, separate controls and optional quiet sound.

## Requirements

- Start opens a dedicated modal counting view. Keep the same native breath button and count state; enlarge the target into a rounded rectangle occupying the available space, with no movement or scaling on press. Keep timer and separate Undo/Cancel visible on the primary portrait profiles (390×844, 440×956), and reachable on small/landscape screens.
- One accepted native click increments exactly once. Do not add a second pointerdown counter, repeat on hold, throttle repeated deliberate taps, count a cancelled gesture, or count beyond the deadline. Keyboard and assistive activation remain supported; keyboard auto-repeat remains suppressed.
- Disable single-finger panning only on the active target using touch-action:pinch-zoom; retain zoom and scrolling outside it. Device validation remains necessary.
- Underlying navigation and forms must not receive input while counting. Escape, Cancel, hidden document and pagehide cancel the count; completion closes the modal and exposes the existing result. Restore the card and focus on every exit; preserve existing zero-count and unsaved-result behavior.
- Sound is opt-in, off on page load, and can be selected before starting. It remains selected across counts in the same page only. Initialise/resume Web Audio directly in Start's user gesture, without awaiting it before starting the count. Only accepted increments may request a short quiet tone; never queue missed tones for later playback. Missing, suspended, rejected or throwing audio must not affect counting. Explain that device volume/mute may prevent sound; no promise of audible output or haptics.
- Preserve journal schema, save behavior, update waiting and background cancellation. No dependencies, cloud mutations, merge or deployment.

## Implementation checklist

### Phase 1: Dedicated view and sound

- Move the existing counter card into a native dialog on Start and restore it using a fixed original anchor on every exit. Open failure must restore idle state. Cancel handling must use the existing cancellation path without leaving an active session hidden.
- Give the modal its own specific layout rules while preserving the existing base-before-responsive source order: safe-area padding, flexible target with 150px minimum height, static controls with a visible gap, no background interaction. The dialog scrolls when text size or zoom makes its content taller than the viewport; primary profiles show the target and controls together.
- Add an opt-in checkbox outside the active view and a small testable audio helper. Audio attempts are independent of count state and cannot mutate a future session after cancellation. Release node connections after each tone; reuse one context per page.

### Phase 2: Verify and document

- Extend browser lifecycle checks and geometry fixtures for the real dialog layout; retain idle Start checks. Exercise pointer/keyboard counts, Undo, Escape, zero completion, normal completion, background cancellation, failed modal open and restoration, and no duplicate increments.
- Verify a dense grid of points across the larger target, controls outside it, no scale on press, safe areas 0/20/34/48, both primary portrait/landscape sizes, narrow/short screens and larger text. Keep actual touch gesture checks separate from synthetic clicks.
- Add explicit held Enter/Space, keyboard repeat and cancelled touch sequences with exact deltas. Hold audio resume pending while accepting taps, cancel/restart with sound on and off, then resolve/reject it; assert no delayed tones or session mutation.
- Unit-test audio missing/rejected/suspended/throwing paths, opt-out, one tone per requested accepted click and node cleanup. Check real local touch input with mild drift and rapid distinct taps, keyboard activation, offline installation and saved-journal reopening.
- Update README/changelog and append a dated superseding decision to the prior counting plan. Keep physical iPhone/VoiceOver/audio acceptance pending. Regenerate release metadata immediately after final app edits, before offline verification, npm test, browser harness and just deploy-check; commit focused changes on the current branch.

## Technical specifications

Explore verified the shared button and controls in `dist/index.html:38–48`, count lifecycle/deadline guards in `dist/app.js:277–392`, native-dialog use at `app.js:69–80`, and layout/harness ownership in `dist/app.css:1104–1128` and `tests/browser-check.mjs:387–475`. The exact-source harness embeds imports via checked substitutions; it must embed the new helper as well. Release metadata is generated by `scripts/release.mjs:20–63`, using the precache list in `dist/sw.js:6–8`. `package.json` declares Node >=22.12.0 and Wrangler 4.161.0; no new dependency is needed. Branch `fix/iphone-counting-layout` resolves to `16d6975095c3d4349851a9aff63df85ddfe668b6` at planning (point-in-time fact).

Modify `dist/index.html`, `dist/app.css`, `dist/app.js`, `dist/sw.js` (asset list), `tests/browser-check.mjs`, and only affected layout assertions in `tests/structure.test.mjs`. Add `dist/tap-sound.mjs` and `tests/tap-sound.test.mjs`; regenerate `dist/version.mjs`, `dist/release.json` and worker digests. Update `README.md`, `CHANGELOG.md`, this plan and the materially superseded decision in the preceding counting plan. Explore facts are contract inputs; correcting them requires re-review.

This is one browser UI feature: Web Audio is an optional browser facility, not an independently implemented service. The service worker changes only to cache the new helper and regenerate identity.

## Testing notes

Desktop Chromium can establish DOM geometry, event handling, modal focus and offline caching. It cannot certify iOS gesture recognition, VoiceOver, silent-mode routing, dynamic Safari chrome or actual audibility. Physical iPhone 12 and iPhone 17 Pro Max checks must include imprecise tapping while looking away, scroll/zoom, lock/app switching and optional sound at a suitable volume.

## Review focus

Exactly one increment per accepted activation; no pointer/click double counting; complete modal teardown; asynchronous audio cannot delay or corrupt counting; no layout changes when digits/timer change; truthful physical-device limitations.

## Acceptance criteria

- Primary portrait profiles present a wider target than the old 225px circle and show separate controls; constrained layouts remain reachable without overlap.
- Event/lifecycle/audio regressions and the full existing suite pass. Dialog input does not reach the background; opening/closing does not lose the original card or pending reading.
- Offline app loads the audio helper and retains journal data. Sound failure leaves all recording behavior intact.
- Docs distinguish current unshipped work, older deployed UI and pending physical acceptance. No deployment.

<!-- reviewed: 2026-11-14 @ 6f8f10552e38850cd3849c64e6e6474cf3b7c48b -->

## Progress

Plan review complete: five lenses, three distinct findings (test coverage and verification order), zero contradictions. All three addressed in the checklist. Implementation, documentation and desktop checks complete; no merge or deployment.

## Findings

Review added delayed-audio/session-rollover and held/cancelled-input checks, and moved metadata generation ahead of offline/test verification. No unresolved design findings.

## Issues and solutions

The reported device-specific cause remains unconfirmed; improving the target does not prove all missed-tap causes are resolved.

## Final results — 14 November 2026

Version 1.1.0 build `6379aad6d342` (after the 14 November decision below; previously `2338a7bf7184`). A code-review fix removed unreachable `:has(.breath-circle.active)` CSS (the card lives in the dialog, outside `main`); `npm test` and the browser harness were re-run on this build, while the touch, screenshot and offline evidence below was gathered on `9116614af4b7`:

- 72 Node tests (69 before the tap-sound decision added three; 71 before the review fix replaced three dead-CSS guards with one), metadata/syntax checks and `just deploy-check` pass. The generated helper digest is included in the worker's precache manifest.
- 24 browser harness checks pass (23 before the tap-sound status check), including modal open failure, queued close events, Escape/zero/completed exits, focus restoration, delayed/rejected audio across session rollover, and the unchanged save/filter/export/update contracts.
- Geometry covers 19 sizes × four bottom insets, scroll positions and a grid of 15 target points. Target dimensions stay stable across 9/10/99/100 counts. Both primary portrait layouts show target and controls together; larger-text/top-side-padding and landscape cases remain reachable. A mutation shrinking the target to its former width fails the width invariant.
- Real Chromium touch sessions at 390×844 and 440×956 pass 8px drift, cancelled touch, held touch, eight rapid taps, held Enter/Space, Undo, modal focus, landscape and Escape. Screenshots inspected. Audio graphs request one oscillator per accepted click when enabled, none for Undo or opt-out. This verifies scheduling, not audible output.
- Fresh service-worker installation and offline reopening pass for both profiles, retaining the saved manual reading and guidance; counting also works offline. No new two-build upgrade test was run; prior upgrade evidence remains in the baseline plan.
- Manual code/security audit: the existing guarded click handler remains the sole increment site; its single tone call follows the increment. No pointer handler increments, audio promises never write measurement state, and all terminal paths restore the card. No storage/schema changes, external network destinations, dependencies or credentials.

Physical acceptance remains pending **on both iPhone 12 and iPhone 17 Pro Max**: imprecise taps while watching the dog; Safari/installed layouts and toolbar changes; pinch zoom and larger text; VoiceOver action/count; sound enabled/disabled with device volume/mute; background/lock cancellation and installed-app upgrade behavior. The reported missed-count cause is still unconfirmed, so this is not a claim that it is resolved on the complainant's device.

## Decision — 14 November 2026: sound recovery, sound status, update notice, result copy

Owner-approved follow-up on build `6379aad6d342`; layout, geometry, touch-action and dialog cancel handling are unchanged.

- **D1 audio recovery.** An accepted tap on a context that is not `running` (suspended, or iOS `interrupted` after a call, Siri or Control Center) requests `resume()` without awaiting it; that tap may stay silent and later taps sound once the context runs. Rejections and throws are swallowed. Ending or cancelling a count suspends the context (not closed, so the next count reuses it). Still one tone per accepted click and none after stop.
- **D2 truthful status.** Ticking **Quiet tap sound** is a user gesture: it creates/resumes the context and the status line shows “Tap sound on…” only when the context runs, otherwise “Tap sound is not available on this device.” Unavailable audio unticks the box, so the checkbox always matches whether counts will try to sound; counting is unaffected. Start still prepares audio in its own gesture without awaiting.
- **D3 update notice.** A notice that arrives during a count sits in content made inert by the modal. When the counting view closes (completion, Cancel, Escape, background), a visible notice's text is cleared and restored 100 ms later so its `role=status` region announces it once.
- **D4 copy.** The finished circle reads “13 / breaths counted” (“breath counted” for one); the active label and accessible name stay “Count one breath”. The instruction says “Tap the large area” instead of naming a colour.

Unit tests cover resume-on-tap, recovery after interruption, suspend on stop, swallowed rejections and availability detection; the harness covers the status line with and without Web Audio, the post-count notice re-announcement, and the new copy. Reverting each fix makes its new test fail. Still unverified on a physical iPhone: audio recovery after a real interruption, VoiceOver announcing the notice after the count (the clear-and-restore technique is not device-tested), and audibility with device volume/mute.
