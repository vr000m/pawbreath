# README and documentation guides

**Status:** In progress — guides verified; screenshot replacement follows
**Component:** Documentation
**Branch:** docs/readme-and-guides
**Created:** 2026-11-15

## Decision

Keep the README as the introduction: journal/About links, two mobile About screenshots, key features, local-storage limitations, a preview command and documentation links. Move detailed use, backup compatibility and update behaviour to `docs/user-guide.md`; development and release commands to `docs/development.md`; Cloudflare operations to `docs/deployment.md`.

Preserve the existing operational guidance. Remove dated production status from the README without asserting a new deployment status. Capture the current local About page in an isolated browser at 390×844, showing its introduction and fictional journal preview. Store the captures in `docs/images/` and remove the superseded README image. App source and release metadata stay unchanged.

## Scope and verification

- [x] Shorten `README.md` and create the three linked guides with return links.
- [ ] Capture and visually inspect both mobile screenshots, including their README presentation.
- [x] Check sibling plans for materially stale references; append a documentation-location correction only where needed.
- [x] Verify local links, retained guidance, documentation-only diff and `npm test`.

This is a documentation reorganisation using the existing application; no runtime feature, dependency or deployment change is required. Historical plans remain decision records. The baseline plan's operational-documentation pointer needs a dated correction. Other plans' accounts of earlier README edits remain historical evidence.

## Outcome

README shortened, detailed guidance moved into three guides, and the baseline documentation pointer corrected. All 22 original instruction/code blocks are preserved. The existing preview remains in this commit; the mobile About screenshots follow separately. The full suite passes 108 tests, and application source is unchanged.
