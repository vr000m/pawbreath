# Pawbreath introduction and installation page

**Status:** Complete — implementation verified; not deployed; physical acceptance pending
**Component:** Pawbreath
**Assignee:** Codex
**Priority:** Normal
**Branch:** feature/about-landing-page
**Created:** 2026-11-15
**Objective:** Explain the journal, sleeping breathing monitoring and phone installation at `/about` without moving the installed app or its data.

## Context

The journal currently opens directly into Measure. The user approved a separate introduction at `/about`, sourced medical guidance and installation instructions. Keep the existing application at `/`. This is a single static-document feature; it adds no independently executing component.

## Requirements

- Explain purpose, one full rise/fall as one breath, 30/60-second counts, context/notes/history and optional recording sound in plain language. Never describe tap replay as a sensor or diagnosis.
- Explain that heart disease can progress to heart failure with fluid in the lungs and faster or harder breathing; vet-prescribed medication can reduce fluid and manage symptoms. A breathing rate alone does not diagnose heart disease. Link veterinary sources, not Cardalis app or video. Attribute Ceva's general above-30/rising sleeping-rate guidance while retaining a blank, vet-defined personal threshold. Include urgent care for struggling to breathe, without drug names/doses or treatment changes.
- Explain settled sleep without panting/active dreaming, consistent context, and comparison over time.
- iPhone-first installation steps must open `/` in Safari before Share → Add to Home Screen, with Open as Web App if offered. Android steps acknowledge changing menu labels. Install the journal, not `/about`. Link official platform help.
- Describe local journals, no accounts/sync, backup/export, and offline app use after setup. The introduction itself needs a connection and is not part of the offline shell.
- Page works without JavaScript; semantic headings, visible focus, readable contrast, reduced-motion compatibility, touch-sized primary links, no horizontal overflow at 320/390/440px. Use the existing cream/green visual language with its own CSS.
- No analytics, third-party embeds/fonts, journal reads/writes, hostname changes or service-worker logic changes. Keep app manifest ID/start URL/scope and storage schema unchanged. Link from Settings in a new tab with noopener/noreferrer and explicit new-tab/online wording.
- Include one real current-app screenshot using exclusively synthetic sample data, labelled as an example, with an adjacent text description. No generated UI mockup. Do not reuse a user's journal.
- Prepare reviewable changes and a PR; do not merge or deploy this work.

## Implementation Checklist

### Phase 1: Introduction and entry point

**Impl files:** `dist/about.html`, `dist/about.css`, `dist/images/journal-example.png`, `dist/index.html`
**Test files:** None; this static addition uses served browser verification.
**Test command:** `npm run release && npm test`
**Goal:** Teach new visitors while keeping the existing journal, origin and installed identity intact.

- Author responsive page with purpose, measurement, medical context, install steps, storage and attributed sources.
- Capture a synthetic History screenshot from the current app in an isolated browser context.
- Add a Settings link; no app JS/CSS or database changes.

### Phase 2: Metadata, docs and validation

**Impl files:** `dist/version.mjs`, `dist/release.json`, `dist/sw.js` (generated lines only), `README.md`, `CHANGELOG.md`, this plan
**Test files:** None; run the existing suites and a temporary browser verification script.
**Test command:** `just deploy-check`
**Goal:** Ship a coherent bundle and accurately describe online introduction versus offline journal.

- Run `npm run release` after all deployed assets are final; keep package version 1.2.0 and record this feature as Unreleased until production deployment.
- Commit the page, entry link and regenerated metadata together so every commit's release check remains coherent.
- Verify routing with Wrangler, desktop/phone layouts, no-JS reading, navigation with populated synthetic journal, offline return to the journal and unchanged precache membership.
- Update README and changelog; keep completed sibling plans as historical records unless a decision is materially superseded.

## Technical Specifications

### Verified facts

Explore verified static hosting in `wrangler.jsonc:4–12`; relative manifest identity/start URL/scope in `dist/manifest.webmanifest:2–10`; Settings cards in `dist/index.html:88–95`; IndexedDB `pawbreath` schema 1 in `dist/data.mjs:199`. `dist/sw.js:4–8,42–59` intercepts only its explicit cached URLs. `tests/structure.test.mjs:15–22,83–88` checks that root-shell dependencies exactly match the cache. `scripts/release.mjs:24–38` hashes every deployed non-dot file recursively, including new static assets, although only the explicit shell is precached. The project uses Node >=22.12.0 and Wrangler 4.161.0; no runtime dependencies. At plan creation, both main and the feature branch resolve to `ec3e502c68a507b945218fd1b823f751ef5ec645` (point-in-time fact). Correcting these source facts requires re-review of the contract.

### Files to Modify

- `dist/index.html`: one Settings link, leaving existing install controls and journal markup intact.
- `dist/version.mjs`, `dist/release.json`, `dist/sw.js`: regenerate release identity/digests; worker executable logic and ASSETS stay unchanged.
- `README.md`, `CHANGELOG.md`: introduce the route, screenshot provenance and online/offline distinction.
- `docs/dev_plans/20261115-feature-about-landing-page.md`: progress and evidence below the marker.

### New Files to Create

- `dist/about.html`: standalone, script-free page, canonical URL `https://pawbreath.com/about`, root-relative assets and app links; no manifest or app-capable tags.
- `dist/about.css`: isolated stylesheet without imports or animation; readable page even without screenshot.
- `dist/images/journal-example.png`: compressed screenshot of a synthetic journal with no external photo or private data.

### Architecture Decisions

Cloudflare's default HTML handling is expected to serve `about.html` at `/about`; verify `/about`, `/about/` and `/about.html` under Wrangler rather than assuming Python preview routing. No DNS or custom route is added. The new page is not precached; this keeps marketing assets out of mandatory app installation. The app's existing offline guidance remains available. All app CTA links resolve to `/`, including installation links. Root manifest identity remains `./`. No new manifest is provided on `/about`.

### Integration Seams

Only an ordinary Settings link connects the journal to the introduction. New-tab navigation preserves current page state; both tabs must close for a downloaded app update to activate. Root-relative local links work after Cloudflare's canonical redirects. Screenshot content is illustrative, never a reader's live data.

## Testing Notes

Run the full Node suite, exact-source browser harness and Wrangler dry run. Serve with Wrangler on localhost; verify real `/about` redirects, content type, CSP and screenshot/CSS loads with no console errors. Check 320px, iPhone 12 (390×844), iPhone 17 Pro Max (440×956), desktop and enlarged text. Verify keyboard focus and no-JS content. Seed a synthetic root journal, visit About, return through Open Pawbreath and compare stored dogs/readings exactly. Install the real worker, confirm the unchanged shell caches, then reopen root offline and verify journal/guidance. Inspect the screenshot and page visually. Browser emulation cannot establish physical Safari installation/VoiceOver; leave those checks pending. No deployment.

## Review Focus

No origin/manifest/database migration; no new worker executable logic or cached paths; no journal access on About. App links must install/open root; online page must not claim to work offline. Medical copy distinguishes heart disease from heart failure, observation from diagnosis, and general reference from personal threshold. Source links must support adjacent claims. New-tab Settings navigation must identify itself and preserve app state.

## Acceptance Criteria

- `/about` is readable at both target phone sizes and desktop, with working root CTA and installation instructions.
- Agreed medical message, no Cardalis app/video links, sourced threshold caveat and urgent-care language are present.
- Synthetic screenshot is labelled and contains no private data; page loads without JS or third-party assets.
- Journal data, app identity, worker behavior and offline reopening remain intact; automated suite and deploy dry run pass.
- README/changelog reflect the final implementation and physical-device checks remain explicitly pending.

<!-- reviewed: 2026-11-15 @ a9bfc5db13849d3905c1d1bfbb61c195a3e76eb1 -->

## Progress

- [x] Ground the plan in repository facts and source guidance.
- [x] Review the plan.
- [x] Implement the introduction and capture sample screenshot.
- [x] Validate and update documentation.

## Findings

Five lens reviews and the contradiction pass completed. Reconciliation: 1 raw finding, 0 merged, 1 unique, 0 related, 0 dropped. The sequencing finding is addressed: regenerate metadata before the Phase 1 test gate as well as after any later asset edits. Review state: `.review-plan/latest-codex.json`.

## Issues & Solutions

The 200% text-size browser check found horizontal overflow. Wrapping long text and allowing the header to wrap fixed it. Temporary test-script API/CSP errors were corrected without weakening the site policy.

## Final Results

Implemented `/about` as a script-free document with its own stylesheet, a 29,742-byte screenshot of fictional Milo readings, and a new-tab Settings link. App version remains 1.2.0; branch build `2d1e976e1580` is unreleased. Production still serves `49910c45716f` (verified 15 November).

Verification: 108 Node tests and 32 exact-source browser harness checks pass; Wrangler deployment dry run passes. Local Workers routing sends `/about`, `/about/` and `/about.html` to the same canonical page. Browser checks pass at 320×700, 390×844, 440×956 and 1440×1000, plus 200% text at 390px. Screenshots were visually inspected. Content/links work with JavaScript disabled; keyboard skip/focus works; same-origin assets load under the existing CSP with zero page runtime errors. A synthetic journal survives About navigation and offline root reload exactly; an unsaved form stays in the original app tab. The 12 precached shell paths are unchanged and exclude About assets.

Evidence: `/private/tmp/pawbreath-about-report.json`, `/private/tmp/pawbreath-about-browser.log`, `/private/tmp/pawbreath-about-harness.log`, `/private/tmp/pawbreath-about-deploy-check.log`. Screenshots: `/private/tmp/pawbreath-about-desktop.png` and `pawbreath-about-iphone12.png` / `pawbreath-about-iphone17promax.png` in that directory. Temporary browser verification scripts use isolated synthetic data, not an existing user profile.

Physical Safari/home-screen installation and VoiceOver remain pending on iPhone 12 and iPhone 17 Pro Max. Chromium size profiles do not verify those interactions. No merge or deployment was performed. Sibling plans were inspected for shared markup/worker references; no historical architecture or data decision was superseded.

Veterinary sources: [Ceva](https://dogheartdisease.com/monitoring/), [Tufts](https://vet.tufts.edu/foster-hospital-small-animals/specialty-services/cardiology/heartsmart/heart-disease-treatments/treatment-congestive-heart-failure). Installation: [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios), [Google](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en). Routing: [Cloudflare](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/). Sources consulted 15 November 2026.
