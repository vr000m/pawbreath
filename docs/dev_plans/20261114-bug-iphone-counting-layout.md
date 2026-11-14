# iPhone counting layout and accessible controls

**Status:** Implemented and desktop-verified; physical acceptance pending
**Component:** Pawbreath
**Assignee:** Codex
**Priority:** High
**Branch:** fix/iphone-counting-layout
**Date:** 2026-11-14
**Objective:** Prevent counting taps from hitting Undo/Cancel and verify the primary phone layouts.

## Context

The live and local baseline is release 1.1.0 build `63316a30696f`, merged in PR #4. At 375×667 with a simulated 34px bottom inset, sticky Undo overlaps the circle by 31.6px. The user primarily uses iPhone 12 and iPhone 17 Pro Max. Their physical Safari/home-screen viewports and keyboard behavior remain unverified.

## Requirements

- Keep Undo/Cancel outside the breath target at every tested viewport, inset and scroll position. Preserve a large tap target; permit scrolling on constrained screens rather than overlaying controls.
- Keep the idle Start affordance reachable. On primary portrait profiles, the circle and active controls should fit above navigation after scrolling if necessary.
- Show a stable visible `Count one breath` action label matching the accessible name. Keep the dynamic count available to assistive technology separately from that name.
- Preserve timer, background cancellation, save/draft behavior, History, backups and updates.
- Correct documentation to distinguish the already-live baseline from this unshipped fix; record exact desktop evidence and outstanding physical tests.
- No merge, deployment or cloud mutation. One feature branch; focused implementation/test and documentation commits.

## Implementation checklist

### Phase 1: Layout and label

- Keep the idle Start bar sticky, but place active Undo/Cancel in normal document flow below the circle. This removes their safe-area offset from the counting target's geometry.
- Reserve bottom padding for fixed navigation plus safe-area inset so all content remains scroll-reachable. Keep existing compact phone rules unless verification proves them unnecessary or harmful.
- Use stable visible/action text; expose the changing count as a description rather than changing the button's name.

### Phase 2: Regression and device-profile verification

- Extend the browser geometry test to cover nonzero simulated safe areas, scrolling, active target hit-testing and idle Start. Update implementation-specific structure checks only where the contract changes; retain unrelated guards.
- Check label/name/description through idle, active, Undo, completion and cancellation, including pointer and keyboard behavior.
- Run the full suite, browser harness, real local preview and dry run. Verify real worker installation/offline reopening for the generated build.

### Phase 3: Delivery documentation

- Move already-live mobile/history changes out of Unreleased into a dated deployed-build entry without inventing a version bump. Put this fix under Unreleased.
- Correct README and the existing plan's merge/deployment status; replace the known-overlap assumption with a dated link to this fix and retain physical-device limitations.

## Technical specifications

Explore verified `dist/index.html:43–47` owns the circle and sibling controls; `dist/app.js:277–385` owns count-state labels and `.active`; `dist/app.css:1100–1117` owns the clamp-sized circle and sticky controls. `tests/browser-check.mjs:371–403` checks geometry but assumes zero insets and sticky active controls. `tests/structure.test.mjs` guards phone media-query order. Node >=22.12 and Wrangler 4.161.0 are declared in `package.json`. Base `main` resolved to `9078bff7fb718ce7318d6699ecb7916aaed07c3a` at planning; refs are point-in-time facts.

Files to modify: `dist/app.css`, `dist/index.html`, `dist/app.js`, `tests/browser-check.mjs`, `tests/structure.test.mjs`, `README.md`, `CHANGELOG.md`, `docs/dev_plans/20261112-feature-pawbreath.md` and this plan. Regenerate `dist/version.mjs`, `dist/release.json`, `dist/sw.js` via `npm run release`; do not hand-edit release digests. No dependency or storage changes. Only browser rendering behavior changes; the worker changes are generated asset metadata, not a second independently implemented component.

## Testing notes

Use nominal CSS profiles 390×844 (iPhone 12) and 440×956 (iPhone 17 Pro Max), plus their landscape dimensions. These are test profiles, not assertions about Safari's usable viewport. Apple's panel specifications are [1170×2532](https://support.apple.com/en-us/111876) and [1320×2868](https://support.apple.com/en-us/125091); profile sizes assume 3× scale. Also exercise 320px width and heights 480, 560, 568, 640, 666, 667, 700, 740, and keyboard-like reduced heights. Sweep bottom insets 0/20/34/48px; include top/side-inset and larger-text stress cases. Simulate insets in test styles only; do not alter production behavior to satisfy a fixture.

Assert circle/control rectangles do not intersect at top, intermediate and bottom scroll positions; hit-test visible circle points and require the breath button, not Undo/Cancel/nav. Scroll each action above fixed navigation and verify it is reachable. Primary portrait profiles must allow circle plus controls together; constrained landscape/keyboard profiles may scroll. Include failure evidence against the old sticky layout so the regression cannot pass vacuously. Physical checks remain explicitly unchecked for both named devices, including VoiceOver, Safari chrome/keyboard, installed app, offline reopen and interruption.

## Review focus

Layout invariants rather than new magic height thresholds; meaningful hit-tests; stable accessible name with discoverable count; no source/test drift; no physical-device or deployment claim inferred from emulation.

## Acceptance criteria

- All tests and dry run pass; safe-area and label regressions fail against the old behavior.
- Desktop browser evidence covers both phone profiles, constrained sizes and state transitions; no tap is intercepted by Undo/Cancel.
- No change to recording or persistence semantics; generated metadata is current.
- README/changelog distinguish live baseline and local fix; prior plan points here without losing historical decisions.
- A short physical iPhone checklist remains pending until the user performs it. That does not block completing the code change, but must not be marked verified.

<!-- reviewed: 2026-11-14 @ 842b6f2fafde740a6ac76218153f40f4667c7f4c -->

## Progress

Implementation and documentation complete. Five plan-review lenses and the contradiction pass returned no findings. The fixes remain unmerged and undeployed.

## Findings and outcome

Active controls now stay in normal flow below the circle at every phone height; idle Start retains its sticky position. Bottom padding reserves navigation plus the safe area. The visible label and accessible name remain `Count one breath`; the count is its accessible description. No timer, storage, update lifecycle or dependency changes were made.

## Verification — 14 November 2026

Build `02a944e1bc7a` (version 1.1.0):

- `npm test` / `just deploy-check`: 68 tests pass, metadata/syntax checks pass, Wrangler dry run succeeds without deployment.
- Browser harness: 21 checks pass. Geometry covers 19 viewport sizes × four bottom insets (0/20/34/48px), three scroll positions, target hit-testing and reachable actions. Four primary portrait/landscape profiles also exercise larger text and simulated top/side padding. Restoring sticky active controls reproduces the old overlap at 375×667 with inset 34px.
- Real local Chromium preview at 390×844 and 440×956: keyboard and pointer counting, Undo, landscape, reduced-height manual Save, and the computed accessible name/description pass. Both profiles reopen offline through the actual service worker with their saved reading and guidance intact. Screenshots were inspected; these are desktop profiles, not physical Safari tests.
- Manual code/security/docs audit: changes are confined to layout, labels, tests, generated asset identity and documentation. No new network destinations, data handling, dependencies or credentials. The historical plan records the superseding decision and deployed baseline separately.

## Physical acceptance — run on each device

| Check | iPhone 12 | iPhone 17 Pro Max |
| --- | --- | --- |
| Safari and installed app: Start reachable; circle/Undo/Cancel separate with browser chrome expanded/collapsed and portrait/landscape | Pending | Pending |
| VoiceOver: action name and count understandable; large text preserves reachable controls | Pending | Pending |
| Real keyboard: manual fields scroll and Save/Cancel remain reachable | Pending | Pending |
| Home-screen installation and offline reopening preserve journal and guidance | Pending | Pending |
| Update with Safari and installed app open preserves active count/forms until closure; app switching/locking cancels interrupted counts | Pending | Pending |

Desktop emulation cannot establish these results. Use the existing two-build upgrade evidence in the [baseline plan](20261112-feature-pawbreath.md) for lifecycle implementation history; this follow-up verifies fresh installation/offline reopening, not a new two-build upgrade.
