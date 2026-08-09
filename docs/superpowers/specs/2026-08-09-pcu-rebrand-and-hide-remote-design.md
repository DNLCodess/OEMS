# PCU Rebrand + Hide Remote Exam Mode — Design

Two small, mechanical changes, bundled because both are pure UI/config surface changes with no data-model or security implications — unlike the access-control and (upcoming) result-model work, neither needs the full design ceremony.

## 1. PCU-only rebrand

**Problem:** OEMS is architecturally multi-tenant (any number of universities), but this deployment is for one institution — Precious Cornerstone University — and should present that way: PCU's own brand, no visible "add another university" framing.

**Theme (`app/globals.css`):** replace the current deep-navy palette with PCU's actual brand, sourced from `~/Developer/pcu/short-course` (which mirrors the real pcu.edu.ng):
- `--color-primary: #3a0a5e` (deep purple)
- `--color-accent: #b91c1c` (red — new token, for CTAs/highlights)
- `--color-gold: #eab308` (new token, secondary accent)
- All other tokens (surfaces, borders, semantic success/danger/warning, text hierarchy) are left as-is — they aren't brand colors, they're functional UI colors, and changing them isn't part of "rebrand."

**Typography:** swap `Plus Jakarta Sans` for `Inter` (body) and add `Playfair Display` for headings only (`h1`–`h6`), matching PCU's own site. `Geist Mono` (used for matric numbers/codes) is unchanged — it's functional, not decorative.

**Copy:** `README.md` and `app/layout.js`'s `metadata` (title/description) updated to name PCU specifically. Product name stays "OEMS" — a full rename is a bigger change for no real benefit; "OEMS — Precious Cornerstone University's CBT platform" carries the framing without it.

**Multi-tenant UI:** remove the "Universities" link from the super-admin sidebar nav (`components/shared/Sidebar.js`). The route (`app/super-admin/universities/*`) and the underlying schema are untouched — this is a visibility change for the demo/writeup, not a removal, consistent with "hide the framing," not "prevent re-expansion later."

## 2. Hide remote exam mode

**Problem:** `exams.exam_mode` supports `'remote'` and `'lab'`. This university will only ever run supervised lab-based CBT sittings — remote should not be offered as a choice.

**Change:**
- `lib/validations/exams.js`: default changes from `'remote'` to `'lab'`.
- `components/exams/ExamSettingsForm.js`: remove the "Delivery Mode" section (both mode cards) and the proctoring toggle block entirely. Proctoring is already coded as remote-only (`proctoring_enabled` is forced to `false` whenever `exam_mode !== 'remote'`), so hiding remote leaves proctoring with no reachable UI — removing it alongside is the honest reflection of that existing coupling, not an independent decision.

**Non-goals:** the `exam_mode` column, the `'remote'` enum value/CHECK constraint, and any code path that already handles both modes identically (the student-facing entry flow, unified since the credential-less-auth work) are untouched. This is a UI-level hide only, per "hide, don't take away."

## Testing

Both changes are visual/config surface only — no new server action or business logic. Verification is a build check (`npx next build`) plus a manual look at the exam settings form and super-admin nav, the same verification approach used for the earlier UI-only task in this session (no component/DOM tests configured in this project).
