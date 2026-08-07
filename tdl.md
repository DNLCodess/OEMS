# OEMS — To Do

## Pending

- [x] Automated tests (Vitest) — Vitest set up; regression tests cover lib/validations/*, lib/dal.js, lib/actions/auth.js, lib/actions/admin.js's inviteUser. Still pending: lib/actions/exams.js, questions.js, attempts.js, results.js, and any Playwright e2e coverage.
- [ ] Super-admin settings page — currently read-only display, needs a real config UI
- [ ] Forced password-reset flow for invited users — they get a static temp password (`ChangeMe123!`) with no forced change at first login
- [ ] Restore `.env.local.example` — deleted from the repo but README setup instructions still reference it
