# University-Branded Paths Design

**Goal:** Give each university a memorable, brandable URL path (`/{slug}/login`) instead of a secret code or a plain shared login page, and let that branding — a primary color and an optional logo — carry through their entire staff experience, not just the login moment.

**Architecture:** A slug is the existing `universities.subdomain` field, already collected and unique — no new "code" concept. New slug-prefixed routes sit alongside the existing generic ones (which keep working unchanged, as a fallback). A single derived-color utility computes light/hover shades from one hex value a university picks, and the same CSS-custom-property override technique injects that color at the top of both the public branded pages and the authenticated lecturer/exam-officer layouts — every existing `bg-primary`/`text-primary`/etc. class in the app already resolves those variables, so no component beyond the injection points needs to change.

**Tech Stack:** Existing stack (Next.js 16 Server Actions/Server Components, Supabase/Postgres, Zod, Tailwind CSS v4's `@theme` CSS-variable system). No new dependencies — color math is plain RGB arithmetic.

## Current State

- `universities.subdomain` (`TEXT NOT NULL UNIQUE`, `^[a-z0-9-]+$`) is already collected at creation and displayed as decorative text (`pcu.oems.edu.ng`) in the super-admin's Universities screens — nothing in the app currently reads the request's hostname or path to resolve a tenant.
- `universities.logo_url` (`TEXT`, nullable) exists and is completely unused anywhere in the app today.
- Staff auth (`signIn` in `lib/actions/auth.js`) is a pure email+password lookup — university is resolved from the account's own `university_id` after authentication, never from any URL. This stays true; nothing about how authentication itself works changes.
- All brand colors are hardcoded, global, PCU-specific CSS custom properties in `app/globals.css`'s `@theme` block (`--color-primary: #3A0A5E` and derived `--color-primary-light`/`--color-primary-hover`). Tailwind v4 compiles `bg-primary`/`text-primary`/etc. utility classes to reference these variables via `var()` — meaning any DOM ancestor that overrides the variable's value changes every descendant utility class automatically, with no component changes required. This is the mechanism the whole feature leans on.
- `/check-result` (`lib/actions/studentAuth.js`'s `verifyResultAccess`) deliberately has **no** university scoping today: matric numbers are only unique per-university, so two students at different universities sharing the same matric number are currently both rejected as an ambiguous match — a real, if rare, false-lockout bug this design fixes for anyone using their own institution's link.
- `/check-result` and `/lab/[code]` are both already dual-mode pages (unauthenticated → show a form; authenticated for the matching session channel → show results/lobby inline at the same URL) — the new slug-aware pages follow this exact established pattern.
- `proxy.js` currently has no way to recognize a slug-prefixed path as public; every new route added here needs an explicit rule or it will be treated as protected and bounce a signed-out visitor to `/login`.

## Data Model

One new column:

```sql
ALTER TABLE universities ADD COLUMN IF NOT EXISTS primary_color TEXT;
```

Nullable. `NULL` means "use the default PCU purple" — every existing university, and any future one that never sets this, behaves exactly as today with zero migration of existing rows needed. No new columns for light/hover shades — those are derived, not stored, so there's one source of truth per university and no risk of the derived values drifting from the base color.

## Color Derivation

New file `lib/universityTheme.js`, pure functions, no dependency:

```js
function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }) {
  const toHex = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function mixToward(rgb, target, amount) {
  return {
    r: rgb.r + (target.r - rgb.r) * amount,
    g: rgb.g + (target.g - rgb.g) * amount,
    b: rgb.b + (target.b - rgb.b) * amount,
  }
}

const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 0, g: 0, b: 0 }

// Derives a light tint and a darker hover shade from one base color, so a
// university only ever has to pick one hex value — not three coordinated
// shades. Validated against PCU's own hand-picked values: mixing 25% toward
// black from #3A0A5E lands within a couple of RGB units of PCU's actual
// --color-primary-hover (#2C0747), so this formula reproduces a real,
// already-in-use design decision rather than an arbitrary guess.
export function deriveThemeColors(primaryHex) {
  const rgb = hexToRgb(primaryHex)
  return {
    primary:      rgbToHex(rgb),
    primaryLight: rgbToHex(mixToward(rgb, WHITE, 0.9)),
    primaryHover: rgbToHex(mixToward(rgb, BLACK, 0.25)),
  }
}

// Buttons and badges using this color always pair it with white text
// (--color-text-on-primary). A color too pale makes that text unreadable —
// this is checked at the point a color is *set*, not discovered later on a
// live login page. Standard YIQ perceived-brightness formula; 170/255 is a
// practical "should still read as a dark background" cutoff.
export function isDarkEnoughForWhiteText(hex) {
  const { r, g, b } = hexToRgb(hex)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness <= 170
}

// Returns a React style object overriding the three CSS custom properties,
// or undefined when the university has no custom color — callers spread
// this directly onto a wrapping element's `style` prop.
export function getUniversityThemeStyle(university) {
  if (!university?.primary_color) return undefined
  const { primary, primaryLight, primaryHover } = deriveThemeColors(university.primary_color)
  return {
    '--color-primary':       primary,
    '--color-primary-light': primaryLight,
    '--color-primary-hover': primaryHover,
  }
}
```

Validation (in `lib/actions/admin.js`'s `universitySchema`):

```js
primary_color: z.string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid hex color')
  .refine(isDarkEnoughForWhiteText, 'This color is too light for white button text to stay readable — try a darker shade.')
  .optional()
  .or(z.literal('')),
logo_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
```

## Routing

Three new routes, all resolving their university by `subdomain = slug.toLowerCase()` via the same unauthenticated-safe admin-client lookup pattern `/lab/[code]` already established, `notFound()` on an unknown slug (same precedent as an unknown lab access code — no distinction made between "typo" and "doesn't exist," both just 404):

- `app/(auth)/[slug]/login/page.js` → `/{slug}/login`. Nested inside the existing `(auth)` route group, so it automatically gets the same generic `(auth)/layout.js` wrapper (page background, centering, the existing "OEMS" brand mark) — that shared layout is **not modified**. The page itself renders a `<UniversityBadge university={...} />` (new small shared component, name + logo if set) above the existing `LoginForm`, and wraps its own content in a `<div style={getUniversityThemeStyle(university)}>` so the "Sign in" button and any other themed element on this page picks up the university's color.
- `app/(auth)/[slug]/forgot-password/page.js` → `/{slug}/forgot-password`. Same pattern. `forgotPassword` itself needs no changes — it's pure email lookup, no tenant concept — this route exists purely to keep the branding and the "back to sign in" link (→ `/{slug}/login`, not generic `/login`) continuous if someone clicks through from their branded login.
- `app/check-result/[slug]/page.js` → `/check-result/{slug}` (slug placed *after* the fixed segment here, not before — deliberately different shape from the auth routes. `check-result` is a separate top-level route, not nested under `(auth)`, and Next.js requires every dynamic segment occupying the same URL position to share one parameter name across the whole app; nesting `[slug]` after a fixed `check-result` segment sidesteps that question entirely instead of relying on a same-named top-level `[slug]` folder resolving consistently across two unrelated route subtrees). Same dual-mode structure as the existing `/check-result`: unauthenticated → the form (with a `university_slug` hidden field and the `UniversityBadge`); authenticated for `result_lookup` channel → the results list, extracted into a new shared `<ResultsList user={...} results={...} />` presentational component so this logic isn't duplicated between the generic and slug-scoped pages.

`/login`, `/forgot-password`, `/check-result`, `/update-password`, and `/lab` are all **unchanged** — every one of them keeps working exactly as it does today, as the permanent fallback.

## Auth Changes

**`signIn`** (`lib/actions/auth.js`) gains one optional check. `LoginForm` renders a hidden `<input name="university_slug">` only when a `universitySlug` prop is passed (i.e., only on the `/{slug}/login` route — the plain `/login` route never renders this field, so its behavior is provably unchanged for every existing call). After a successful password check and profile fetch:

```js
const universitySlug = formData.get('university_slug')?.trim().toLowerCase() || null
if (universitySlug) {
  const { data: uni } = await supabase.from('universities').select('id').eq('subdomain', universitySlug).maybeSingle()
  if (uni && uni.id !== profile?.university_id) {
    await supabase.auth.signOut()
    return { errors: { _form: "This sign-in page belongs to a different institution. Use your own institution's link, or the general sign-in page." } }
  }
}
```

Signs the session back out and returns a form error rather than continuing to the redirect — the account itself is genuinely valid (password already checked), this is purely "wrong portal," not a security rejection, so the message says so plainly.

**`verifyResultAccess`** (`lib/actions/studentAuth.js`) gains the same optional-field pattern for a real fix, not just presentational threading:

```js
const universitySlug = formData.get('university_slug')?.trim().toLowerCase() || null
let universityId = null
if (universitySlug) {
  const { data: uni } = await adminClient.from('universities').select('id').eq('subdomain', universitySlug).maybeSingle()
  if (!uni) return GENERIC_ERROR // fail closed on an unrecognized slug, not open
  universityId = uni.id
}

let query = adminClient
  .from('users')
  .select('id, email, is_active')
  .eq('role', 'student')
  .eq('matric_number', matric_number)
  .eq('date_of_birth', date_of_birth)
if (universityId) query = query.eq('university_id', universityId)
const { data: students } = await query
```

...and the existing hardcoded `redirect('/check-result')` becomes `redirect(universitySlug ? `/check-result/${universitySlug}` : '/check-result')`, so a slug-scoped verification lands back on the slug-scoped page (same self-redirect-to-authenticated-view pattern already used by `/lab/[code]`).

## Theming the Authenticated App

`app/lecturer/layout.js` and `app/admin/layout.js` (school_admin) both already call `requireRole(...)` and get back `user` before rendering `Sidebar`. Each gains one more fetch and wraps its existing root `<div className="flex h-screen overflow-hidden">`:

```js
const { data: university } = await supabase
  .from('universities')
  .select('primary_color, logo_url')
  .eq('id', user.university_id)
  .maybeSingle()

return (
  <div className="flex h-screen overflow-hidden" style={getUniversityThemeStyle(university)}>
    <Sidebar user={user} />
    ...
```

`getUniversityThemeStyle` returns `undefined` for a university with no `primary_color` set, and `style={undefined}` is a no-op in React — so a university that never customizes anything renders byte-for-byte identically to today. `app/super-admin/layout.js` is **not touched** — super admins are platform-wide (`university_id` is `NULL` for them), so there's no university to theme from.

Logo: `Sidebar.js`'s existing brand mark (a `GraduationCap` icon in a colored square, next to the "OEMS" wordmark) shows the university's `logo_url` image in place of the icon when one is set, falling back to the current icon otherwise — same "only if set" pattern as the color.

## Configuration

Extends the existing super-admin Universities screens rather than building new ones — provisioning branding stays a platform-admin action, consistent with how universities are created there today:

- `CreateUniversityForm.js` gains a native `<input type="color">` (built-in browser swatch picker, outputs a hex string directly — no picker library needed) for `primary_color`, and a plain URL text input for `logo_url`. Both optional.
- The existing Universities list (`app/super-admin/universities/page.js`) gains a small inline "Edit branding" toggle per row, reusing the same two fields against a new `updateUniversityBranding(universityId, data)` action in `lib/actions/admin.js` (same validation as creation, scoped `.eq('id', universityId)` on update).

## Link Discovery

A new card on the Exam Officer's dashboard (`app/admin/dashboard/page.js`) — "Your staff sign-in link" — showing `${process.env.NEXT_PUBLIC_SITE_URL}/{their own subdomain}/login` (falling back to just the relative path if that env var isn't set, so it's still useful in local dev) with a copy-to-clipboard button. Scoped to their own university only via the existing `requireRole('school_admin')` + `user.university_id` already available in that page.

## `proxy.js` Changes

Two changes, both additive:

1. New regex check recognizing the auth routes' shape: `/^\/[a-z0-9-]+\/(login|forgot-password)$/`. Matching paths are folded into the same bucket as plain `/login`/`/forgot-password` (`isPublicAuthPath`) — reachable while signed out, and an already-authenticated visitor who lands there is redirected straight to their own dashboard, exactly like the plain routes already behave.
2. `/check-result` moves from `EXACT_PUBLIC_PATHS` into the existing prefix-matching bucket (`PREFIX_PUBLIC_PATHS`, currently just `['/lab']`) — its existing exact-match behavior for the bare path is preserved by the same `pathname === p` branch the prefix matcher already checks, while also now correctly covering `/check-result/{slug}`.

## Error Handling

- Unknown slug anywhere (`/{slug}/login`, `/{slug}/forgot-password`, `/check-result/{slug}`) → standard 404, no distinction from a typo.
- Wrong-portal login attempt → signed back out, clear non-alarming form error (this is a genuinely valid account, not a security event).
- Unrecognized slug submitted to `verifyResultAccess` (shouldn't happen through the UI, but the action is an independently callable endpoint like every other Server Action this session has had to account for) → the same generic "check your details" error already used for every other lookup failure, not a distinct message — never confirm or deny a slug's validity to an unauthenticated caller.
- A `primary_color` that fails the contrast check is rejected at submit time in the super-admin form, with a specific, actionable message — never silently accepted and discovered broken later on a live page.

## Testing

- `lib/universityTheme.test.js` — `deriveThemeColors` (including the PCU-value cross-check noted in the code comment above), `isDarkEnoughForWhiteText` (clear pass/fail cases plus the exact boundary), `getUniversityThemeStyle` (both the "has a color" and "no color, returns undefined" cases).
- `lib/actions/auth.test.js` — new cases for `signIn`'s mismatch check: matching university passes through to redirect as normal, mismatched university signs out and returns the form error, no slug submitted behaves identically to every existing test in this file (regression guard that the new code path is fully opt-in).
- `lib/actions/studentAuth.test.js` — new cases for `verifyResultAccess`'s university-scoped variant: a slug that resolves and correctly scopes the query, an unrecognized slug failing closed, and confirmation that omitting the slug entirely still reproduces the existing "ambiguous cross-university match is rejected" test already in this file.
- `lib/actions/admin.test.js` (create if it doesn't already exist covering `universitySchema`) — the contrast-check rejection and acceptance cases for `primary_color`.

## Out of Scope

- `/update-password` and `/lab` slug variants — explicitly decided against; see the design discussion (no typed-URL branding moment for the former, the access code already fully disambiguates the university for the latter).
- Exam-officer self-service branding (a settings page for the Exam Officer role itself to edit their own university's color/logo, rather than going through super admin) — a reasonable future step, not needed for this pass.
- Any color beyond primary (`--color-accent`, `--color-gold` stay fixed platform-wide) — one color slot delivers the large majority of visual identity (sidebar, buttons, active nav, badges) for a fraction of the configuration UI complexity three coordinated values would need.
- Logo file upload — `logo_url` is a pasted, already-hosted image URL; no Supabase Storage integration.
