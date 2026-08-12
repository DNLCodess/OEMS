# University-Branded Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each university a memorable `/{slug}/login` URL (reusing the existing `universities.subdomain` field) and let their own primary color and logo carry through their entire staff experience, while every existing generic route keeps working unchanged as a permanent fallback.

**Architecture:** A single derived-color utility computes light/hover shades from one hex value; the same CSS-custom-property override technique (Tailwind v4's `@theme` values are real `var()`-backed custom properties) injects that color at the top of both new public branded pages and the existing authenticated lecturer/exam-officer layouts, so every existing `bg-primary`/`text-primary` class in the app picks it up automatically. New slug-prefixed routes sit alongside the generic ones — nothing existing is removed or restructured.

**Tech Stack:** Next.js 16 Server Actions/Server Components, Supabase/Postgres, Zod, Vitest, Tailwind CSS v4. No new dependencies.

## Global Constraints

- `universities.primary_color` is nullable — `NULL` means "use the default PCU purple." Every task must verify the no-color path is byte-for-byte unchanged from today's behavior.
- No new dependency. Color math is plain RGB arithmetic in `lib/universityTheme.js`.
- `logo_url` already exists on `universities` (unused today) — no migration needed for it.
- Matching field for slugs is always `subdomain`, looked up case-insensitively (`slug.toLowerCase()`), `notFound()` on no match — same precedent as an unknown `/lab/{code}`.
- `/login`, `/forgot-password`, `/check-result`, `/update-password`, `/lab` all keep working completely unchanged — every new route is additive.
- `/{slug}/login` and `/{slug}/forgot-password` place the slug *before* the fixed segment (both nested under the existing `(auth)` route group, sharing one `[slug]` dynamic segment). `/check-result/{slug}` places the slug *after* — deliberately, not an inconsistency to fix: `check-result` is a separate top-level route outside `(auth)`, and this ordering avoids two unrelated route subtrees both needing to resolve a top-level `[slug]` segment consistently.
- Every task touching a shared/existing surface (`signIn`, `verifyResultAccess`, the two authenticated layouts) needs at least one test asserting the pre-existing (no-slug / no-color) behavior is unchanged — this is the backward-compatibility guarantee the whole plan leans on.

---

### Task 1: Color derivation utility + migration

**Files:**
- Create: `supabase/migrations/20260811150000_university_primary_color.sql`
- Create: `lib/universityTheme.js`
- Test: `lib/universityTheme.test.js`

**Interfaces:**
- Produces (used by every later task):
  - `deriveThemeColors(primaryHex: string): { primary: string, primaryLight: string, primaryHover: string }`
  - `isDarkEnoughForWhiteText(hex: string): boolean`
  - `getUniversityThemeStyle(university: { primary_color?: string|null } | null | undefined): { '--color-primary': string, '--color-primary-light': string, '--color-primary-hover': string } | undefined`

- [ ] **Step 1: Write the migration file**

```sql
-- Lets a university customize its primary brand color, shown on its
-- /{slug}/login and other branded pages and carried through its staff's
-- entire authenticated session. NULL (every existing row, and any future
-- one that never sets it) means "use the default PCU purple" — this column
-- is purely additive, nothing existing changes behavior.
-- Applied: pending

ALTER TABLE universities ADD COLUMN IF NOT EXISTS primary_color TEXT;
```

- [ ] **Step 2: Apply the migration**

Check whether Supabase MCP tools are available in this session (they were connected earlier tonight but the connection state can change). If `mcp__supabase__apply_migration` is available, use it to apply this migration directly to the live project, then update the file's header to `-- Applied: YYYY-MM-DD (applied directly via Supabase MCP)`. If not available, tell the user to run it manually via the Supabase dashboard's SQL Editor (same fallback this repo has used before — see `supabase/migrations/README.md`), and leave the header as `-- Applied: pending` until they confirm.

- [ ] **Step 3: Write the failing tests**

Create `lib/universityTheme.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { deriveThemeColors, isDarkEnoughForWhiteText, getUniversityThemeStyle } from './universityTheme'

describe('deriveThemeColors', () => {
  it('returns the input color, uppercased, as primary', () => {
    const result = deriveThemeColors('#3a0a5e')
    expect(result.primary).toBe('#3A0A5E')
  })

  it('derives a hover shade close to PCU\'s own hand-picked value, validating the formula against a real design decision', () => {
    // PCU's actual --color-primary-hover (#2C0747) was hand-picked, not
    // formula-derived — this checks the 25%-toward-black formula lands
    // within a few RGB units of it, not an exact match.
    const result = deriveThemeColors('#3A0A5E')
    expect(result.primaryHover).toBe('#2C0745')
  })

  it('derives a light tint mixed toward white', () => {
    const result = deriveThemeColors('#3A0A5E')
    expect(result.primaryLight).toBe('#E9DEF1')
  })

  it('derives all three shades from black', () => {
    const result = deriveThemeColors('#000000')
    expect(result).toEqual({
      primary:      '#000000',
      primaryLight: '#E6E6E6',
      primaryHover: '#000000',
    })
  })
})

describe('isDarkEnoughForWhiteText', () => {
  it('accepts a dark color', () => {
    expect(isDarkEnoughForWhiteText('#3A0A5E')).toBe(true)
  })

  it('rejects a pale color white text would be unreadable on', () => {
    expect(isDarkEnoughForWhiteText('#F5F5F5')).toBe(false)
  })

  it('accepts pure black and rejects pure white, the two extremes', () => {
    expect(isDarkEnoughForWhiteText('#000000')).toBe(true)
    expect(isDarkEnoughForWhiteText('#FFFFFF')).toBe(false)
  })
})

describe('getUniversityThemeStyle', () => {
  it('returns undefined when the university has no primary_color set', () => {
    expect(getUniversityThemeStyle({ primary_color: null })).toBeUndefined()
  })

  it('returns undefined for null/undefined university (no lookup found)', () => {
    expect(getUniversityThemeStyle(null)).toBeUndefined()
    expect(getUniversityThemeStyle(undefined)).toBeUndefined()
  })

  it('returns the three CSS custom properties when a color is set', () => {
    const style = getUniversityThemeStyle({ primary_color: '#3A0A5E' })
    expect(style).toEqual({
      '--color-primary':       '#3A0A5E',
      '--color-primary-light': '#E9DEF1',
      '--color-primary-hover': '#2C0745',
    })
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run lib/universityTheme.test.js`
Expected: FAIL — `lib/universityTheme.js` does not exist yet.

- [ ] **Step 5: Write the implementation**

Create `lib/universityTheme.js`:

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
// this directly onto a wrapping element's `style` prop. style={undefined}
// is a React no-op, so a university with no color renders identically to
// today with zero special-casing at call sites.
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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run lib/universityTheme.test.js`
Expected: PASS — all tests green. If the exact hex values in the "close to PCU's own value" or "light tint" tests don't match what your implementation produces, run the function manually (`node -e "console.log(require('./lib/universityTheme.js'))"` won't work directly since this is an ES module — instead temporarily log the values from within the test run) and update the expected literals in the test to match your implementation's actual deterministic output, rather than changing the formula to hit a pre-guessed number.

- [ ] **Step 7: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260811150000_university_primary_color.sql lib/universityTheme.js lib/universityTheme.test.js
git commit -m "feat: add university primary_color migration and theme-derivation utility"
```

---

### Task 2: `signIn` and `verifyResultAccess` university-scoping

**Files:**
- Modify: `lib/actions/auth.js`
- Modify: `lib/actions/auth.test.js`
- Modify: `lib/actions/studentAuth.js`
- Modify: `lib/actions/studentAuth.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 — this task is independently testable (the hidden form fields these actions read don't exist in any UI yet; that comes in Task 3).
- Produces: `signIn` and `verifyResultAccess` both silently accept an optional `university_slug` form field. Task 3's new pages/forms will render that hidden field; the plain `/login` and `/check-result` forms never will, so their behavior is provably unchanged.

- [ ] **Step 1: Write the failing tests for `signIn`**

Add to `lib/actions/auth.test.js`, inside the existing `describe('signIn', ...)` block, after the last existing `it(...)` (the "redirects to the role home on success..." one, currently ending the block just before its closing `})`):

```js
  it('signs back out and returns a form error when the slug does not match the account\'s own university', async () => {
    const client = createMockSupabaseClient({
      users:        [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
      universities: [{ data: { id: 'uni-2' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    client.auth.signOut.mockResolvedValue({ error: null })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    const result = await signIn(undefined, formData({
      email: 'user@example.com', password: 'secret1', university_slug: 'other-uni',
    }))

    expect(result.errors._form).toBe(
      "This sign-in page belongs to a different institution. Use your own institution's link, or the general sign-in page."
    )
    expect(client.auth.signOut).toHaveBeenCalled()
  })

  it('redirects normally when the slug matches the account\'s own university', async () => {
    const client = createMockSupabaseClient({
      users:        [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
      universities: [{ data: { id: 'uni-1' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signIn(undefined, formData({
      email: 'user@example.com', password: 'secret1', university_slug: 'pcu',
    }))).rejects.toThrow('REDIRECT:/lecturer/dashboard')

    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('never checks a university at all when no slug is submitted (plain /login, unchanged)', async () => {
    const client = createMockSupabaseClient({
      users: [{ data: { role: 'lecturer', university_id: 'uni-1' }, error: null }],
    })
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    createClient.mockResolvedValue(client)

    const adminClient = createMockSupabaseClient({ admin_action_log: [{ data: null, error: null }] })
    createAdminClient.mockReturnValue(adminClient)

    await expect(signIn(undefined, formData({ email: 'user@example.com', password: 'secret1' })))
      .rejects.toThrow('REDIRECT:/lecturer/dashboard')

    expect(client.from).not.toHaveBeenCalledWith('universities')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: FAIL — the mismatch check doesn't exist yet, so the first two new tests fail (no sign-out call, or the wrong redirect never gets rejected). The third should already pass since it describes current behavior — confirm it does, as your baseline.

- [ ] **Step 3: Implement the check in `signIn`**

In `lib/actions/auth.js`, modify the success path of `signIn` (currently lines 54–70) to insert the mismatch check between fetching `profile` and logging `logged_in`:

```js
  // Fetch role from profile so we can redirect to the right dashboard
  const { data: profile } = await supabase
    .from('users')
    .select('role, university_id')
    .eq('id', data.user.id)
    .single()

  // Only present when this sign-in came from a /{slug}/login URL (Task 3) —
  // plain /login never renders this field, so this whole block is a no-op
  // for every existing call site. This is a "wrong portal" mismatch, not a
  // credential problem: the password already checked out, so this doesn't
  // log a login_failed event — it just doesn't continue into their
  // dashboard from a URL that isn't theirs.
  const universitySlug = formData.get('university_slug')?.trim().toLowerCase() || null
  if (universitySlug) {
    const { data: uni } = await supabase
      .from('universities')
      .select('id')
      .eq('subdomain', universitySlug)
      .maybeSingle()
    if (uni && uni.id !== profile?.university_id) {
      await supabase.auth.signOut()
      return {
        errors: {
          _form: "This sign-in page belongs to a different institution. Use your own institution's link, or the general sign-in page.",
        },
      }
    }
  }

  await logAuthEvent(createAdminClient(), {
    university_id:  profile?.university_id ?? null,
    actor_id:       data.user.id,
    action:         'logged_in',
    target_user_id: data.user.id,
    subject_role:   profile?.role ?? null,
  })

  const home = ROLE_HOME[profile?.role] ?? '/login'
  redirect(home)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/auth.test.js`
Expected: PASS — all tests green, including every pre-existing test in this file (regression check).

- [ ] **Step 5: Write the failing tests for `verifyResultAccess`**

Add to `lib/actions/studentAuth.test.js`, inside the existing `describe('verifyResultAccess', ...)` block, after the last existing `it(...)` (the "blocks after too many failed attempts..." one):

```js
  it('scopes the lookup to one university when a slug is submitted, and redirects to the slug-scoped result page', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      universities: [{ data: { id: 'uni-1' }, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@uni-1.students.oems.internal', is_active: true, university_id: 'uni-1' }], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)
    mintStudentSession.mockResolvedValue({ ok: true })

    await expect(
      verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12', university_slug: 'pcu' }))
    ).rejects.toThrow('REDIRECT')

    const usersQuery = adminClient.from.mock.results
      .filter((_, i) => adminClient.from.mock.calls[i][0] === 'users')
      .map(r => r.value)[0]
    expect(usersQuery.eq).toHaveBeenCalledWith('university_id', 'uni-1')
    expect(redirect).toHaveBeenCalledWith('/check-result/pcu')
  })

  it('fails closed on an unrecognized slug instead of falling back to an unscoped search', async () => {
    // Only what this path actually touches: the rate-limit check, then the
    // universities lookup that comes back empty — the function returns
    // immediately after that, before ever reaching users, the second
    // verification_attempts call, or admin_action_log, so none of those are
    // queued here.
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }],
      universities: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({
      matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12', university_slug: 'nonexistent',
    }))

    expect(result).toEqual(GENERIC)
    expect(adminClient.from).not.toHaveBeenCalledWith('users')
  })

  it('still rejects a cross-university collision as ambiguous when no slug is submitted (unchanged)', async () => {
    const adminClient = createMockSupabaseClient({
      verification_attempts: [{ data: null, error: null, count: 0 }, { data: null, error: null }],
      users: [{ data: [{ id: 'a', email: 'a@x', is_active: true }, { id: 'b', email: 'b@x', is_active: true }], error: null }],
      admin_action_log: [{ data: null, error: null }],
    })
    createAdminClient.mockReturnValue(adminClient)

    const result = await verifyResultAccess(undefined, formData({ matric_number: 'CSC/2021/001', date_of_birth: '2003-04-12' }))

    expect(result).toEqual(GENERIC)
    expect(mintStudentSession).not.toHaveBeenCalled()
    expect(adminClient.from).not.toHaveBeenCalledWith('universities')
  })
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: FAIL — the new scoping behavior and the `/check-result/{slug}` redirect don't exist yet. The third new test should already pass (it's the pre-existing behavior, unchanged) — confirm it does.

- [ ] **Step 7: Implement the check in `verifyResultAccess`**

In `lib/actions/studentAuth.js`, modify `verifyResultAccess` (currently lines 166–210):

```js
export async function verifyResultAccess(prevState, formData) {
  const parsed = resultAccessSchema.safeParse({
    matric_number: formData.get('matric_number')?.trim().toUpperCase(),
    date_of_birth: formData.get('date_of_birth'),
  })
  if (!parsed.success) return GENERIC_ERROR

  const { matric_number, date_of_birth } = parsed.data
  const ip = await getClientIp()
  const adminClient = createAdminClient()

  if (await isRateLimited(adminClient, matric_number)) return RATE_LIMITED_ERROR

  // Only present when this lookup came from a /check-result/{slug} URL
  // (Task 3) — plain /check-result never renders this field. Scoping by
  // university_id removes the ambiguous-match rejection below for anyone
  // using their own institution's link, since matric numbers are only
  // unique per-university, not platform-wide.
  const universitySlug = formData.get('university_slug')?.trim().toLowerCase() || null
  let universityId = null
  if (universitySlug) {
    const { data: uni } = await adminClient
      .from('universities')
      .select('id')
      .eq('subdomain', universitySlug)
      .maybeSingle()
    if (!uni) return GENERIC_ERROR // fail closed on an unrecognized slug, not open
    universityId = uni.id
  }

  // No university scoping in the no-slug case — matric numbers are only
  // unique per university, so a cross-university match is treated as
  // ambiguous and rejected the same as no match. See Global Constraints in
  // the plan.
  let query = adminClient
    .from('users')
    .select('id, email, is_active, university_id')
    .eq('role', 'student')
    .eq('matric_number', matric_number)
    .eq('date_of_birth', date_of_birth)
  if (universityId) query = query.eq('university_id', universityId)
  const { data: students } = await query

  if (!students || students.length !== 1 || !students[0].is_active) {
    await recordFailedAttempt(adminClient, matric_number, ip)
    await logAuthEvent(adminClient, students?.length === 1
      ? { action: 'login_failed', target_user_id: students[0].id, university_id: students[0].university_id }
      : { action: 'login_failed', target_identifier: matric_number }
    )
    return GENERIC_ERROR
  }

  const session = await mintStudentSession(students[0].email, 'result_lookup')
  if (session.error) return GENERIC_ERROR

  await clearFailedAttempts(adminClient, matric_number)
  await logAuthEvent(adminClient, {
    action:         'logged_in',
    target_user_id: students[0].id,
    actor_id:       students[0].id,
    university_id:  students[0].university_id,
  })

  redirect(universitySlug ? `/check-result/${universitySlug}` : '/check-result')
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/studentAuth.test.js`
Expected: PASS — all tests green, including every pre-existing test in this file.

- [ ] **Step 9: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/actions/auth.js lib/actions/auth.test.js lib/actions/studentAuth.js lib/actions/studentAuth.test.js
git commit -m "feat: add optional university-slug scoping to signIn and verifyResultAccess"
```

---

### Task 3: New slug-prefixed routes and shared components

**Files:**
- Create: `components/shared/UniversityBadge.js`
- Create: `components/student/ResultsList.js`
- Modify: `app/check-result/page.js` (extract results-rendering JSX into `ResultsList`)
- Modify: `app/(auth)/login/LoginForm.js` (add optional `universitySlug`/`universityName` props)
- Modify: `app/(auth)/forgot-password/ForgotPasswordForm.js` (add optional `universitySlug`/`universityName` props)
- Modify: `app/check-result/CheckResultForm.js` (add optional `universitySlug`/`universityName` props)
- Create: `app/(auth)/[slug]/login/page.js`
- Create: `app/(auth)/[slug]/forgot-password/page.js`
- Create: `app/check-result/[slug]/page.js`

**Interfaces:**
- Consumes: `getUniversityThemeStyle` from `lib/universityTheme.js` (Task 1); `signIn`/`verifyResultAccess` already accept `university_slug` (Task 2).
- Produces: `<UniversityBadge university={{ name, logo_url }} />`, `<ResultsList user={{ full_name, matric_number }} results={[...]} />` — both consumed only within this task's own new pages, but kept as their own files per the file-structure guidance (one clear responsibility each, testable/reasoned-about in isolation).

- [ ] **Step 1: Create the shared `UniversityBadge` component**

Create `components/shared/UniversityBadge.js`:

```jsx
import { Building2 } from 'lucide-react'

// Shown above a form on a /{slug}/... page, identifying which institution
// this branded page belongs to — same visual pattern as /lab/[code]'s
// "Lab Session · Code: X" pill. Shown alongside, not instead of, the
// generic OEMS brand mark the shared (auth) layout always renders — this is
// tenant identity, not platform identity.
export function UniversityBadge({ university }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      <span className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-1.5 rounded-full">
        {university.logo_url
          ? <img src={university.logo_url} alt="" className="size-3.5 rounded-full object-cover" />
          : <Building2 size={12} />
        }
        {university.name}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Extract `ResultsList` from `app/check-result/page.js`**

Read the current `app/check-result/page.js` in full before editing — it contains the exact JSX to extract (the score-card list currently inline in the "Verified for result lookup" branch, roughly the `enriched.length === 0 ? ... : ...` block through the closing of that ternary).

Create `components/student/ResultsList.js`:

```jsx
import { CheckCircle2, XCircle, BarChart2 } from 'lucide-react'

// Deliberately minimal: no trend indicators, no per-course averages, no
// browsing into other exams — just what a matric+DOB lookup is for. Shared
// between the generic /check-result and the university-scoped
// /check-result/{slug}, which otherwise have identical "verified, show
// results" rendering.
export function ResultsList({ user, results }) {
  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">
          {user.full_name}
        </h1>
        <p className="font-mono text-xs text-text-muted mt-1">{user.matric_number}</p>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12">
          <BarChart2 size={32} className="mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary">No submitted exams found for this student yet.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {results.map((r, i) => (
            <div
              key={i}
              className={`bg-surface border rounded-2xl p-4 flex items-center gap-4 ${
                r.passed ? 'border-success/20' : 'border-danger/20'
              }`}
            >
              <div className="shrink-0 flex flex-col items-center w-14">
                <div className={`text-lg font-bold tabular-nums ${r.passed ? 'text-success' : 'text-danger'}`}>
                  {r.pct}%
                </div>
                {r.passed
                  ? <CheckCircle2 size={14} className="text-success mt-0.5" />
                  : <XCircle     size={14} className="text-danger mt-0.5"  />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-text-muted">{r.exams?.courses?.course_code}</p>
                <p className="text-sm font-semibold text-text-primary truncate">{r.exams?.title}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-text-primary tabular-nums">
                  {r.final_score}<span className="text-xs text-text-muted">/{r.totalMarks}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Modify `app/check-result/page.js`: replace the whole "Verified for result lookup" return block's score-card JSX with `<ResultsList user={user} results={enriched} />`, keeping the surrounding `<div className="flex-1 px-4 py-16">` wrapper and the `<CheckAnotherResultButton />` below it exactly as they are today. Add the import: `import { ResultsList } from '@/components/student/ResultsList'`.

- [ ] **Step 3: Add optional slug props to `LoginForm`**

Modify `app/(auth)/login/LoginForm.js`: add a `universitySlug` prop (default `undefined`), render a hidden input only when present, and wire the "Don't have an account?" footer text to stay generic (it already is). Full updated file:

```jsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'
import { signIn } from '@/lib/actions/auth'
import { use } from 'react'

export function LoginForm({ searchParams, universitySlug }) {
  const params = use(searchParams)
  const [state, formAction] = useActionState(signIn, null)

  const passwordUpdated = params?.message === 'password_updated'
  const accountSuspended = params?.error === 'account_suspended'

  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-1">Sign in to your account</h1>
      <p className="text-sm text-text-secondary mb-6">
        Use your institutional email and password.
      </p>

      {/* Contextual notices — shown only when relevant */}
      {passwordUpdated && (
        <div className="mb-4 rounded-lg bg-success-light border border-success/20 px-4 py-3 text-sm text-success">
          Password updated. You can sign in with your new password.
        </div>
      )}
      {accountSuspended && (
        <div className="mb-4 rounded-lg bg-danger-light border border-danger/20 px-4 py-3 text-sm text-danger">
          Your account has been suspended. Contact your Exam Officer.
        </div>
      )}

      <form action={formAction} noValidate className="space-y-4">
        {universitySlug && <input type="hidden" name="university_slug" value={universitySlug} />}
        <Input
          id="email"
          name="email"
          type="email"
          label="Email address"
          placeholder="you@university.edu.ng"
          required
          autoComplete="email"
          autoFocus
          error={state?.errors?.email?.[0]}
        />
        <Input
          id="password"
          name="password"
          type="password"
          label="Password"
          placeholder="••••••••"
          required
          autoComplete="current-password"
          error={state?.errors?.password?.[0]}
        />

        {/* Form-level error (wrong credentials etc.) */}
        {state?.errors?._form && (
          <p role="alert" className="text-sm text-danger">
            {state.errors._form}
          </p>
        )}

        <SubmitButton className="w-full mt-2" loadingText="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <div className="mt-5 text-center">
        <Link
          href={universitySlug ? `/${universitySlug}/forgot-password` : '/forgot-password'}
          className="text-sm text-primary hover:text-primary-hover underline underline-offset-2"
        >
          Forgot your password?
        </Link>
      </div>

      <p className="mt-6 text-xs text-text-muted text-center leading-relaxed">
        Don&apos;t have an account? Contact your institution&apos;s Exam Officer to be registered.
      </p>
    </>
  )
}
```

- [ ] **Step 4: Add optional slug props to `ForgotPasswordForm`**

Modify `app/(auth)/forgot-password/ForgotPasswordForm.js`: add a `universitySlug` prop, update both "Back to sign in" links to point at `/${universitySlug}/login` when present:

```jsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'
import { forgotPassword } from '@/lib/actions/auth'
import { MailCheck } from 'lucide-react'

export function ForgotPasswordForm({ universitySlug }) {
  const [state, formAction] = useActionState(forgotPassword, null)
  const loginHref = universitySlug ? `/${universitySlug}/login` : '/login'

  if (state?.success) {
    return (
      <div className="text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success-light mb-4">
          <MailCheck className="size-6 text-success" />
        </span>
        <h1 className="text-xl font-bold text-text-primary mb-2">Check your email</h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          If that email is registered, you&apos;ll receive a reset link shortly. Check your inbox and spam folder.
        </p>
        <Link
          href={loginHref}
          className="inline-block mt-6 text-sm text-primary hover:text-primary-hover underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <h1 className="text-xl font-bold text-text-primary mb-1">Reset your password</h1>
      <p className="text-sm text-text-secondary mb-6">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      <form action={formAction} noValidate className="space-y-4">
        <Input
          id="email"
          name="email"
          type="email"
          label="Email address"
          placeholder="you@university.edu.ng"
          required
          autoFocus
          error={state?.errors?.email?.[0]}
        />

        {state?.errors?._form && (
          <p role="alert" className="text-sm text-danger">
            {state.errors._form}
          </p>
        )}

        <SubmitButton className="w-full mt-2" loadingText="Sending link…">
          Send reset link
        </SubmitButton>
      </form>

      <div className="mt-5 text-center">
        <Link
          href={loginHref}
          className="text-sm text-text-secondary hover:text-text-primary underline underline-offset-2"
        >
          Back to sign in
        </Link>
      </div>
    </>
  )
}
```

- [ ] **Step 5: Add optional slug props to `CheckResultForm`**

Modify `app/check-result/CheckResultForm.js`: add a `universitySlug` prop, render the hidden field:

```jsx
'use client'

import { useActionState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { verifyResultAccess } from '@/lib/actions/studentAuth'

export function CheckResultForm({ universitySlug }) {
  const [state, formAction, pending] = useActionState(verifyResultAccess, null)

  return (
    <form action={formAction} className="space-y-5">
      {universitySlug && <input type="hidden" name="university_slug" value={universitySlug} />}
      <div>
        <label htmlFor="matric_number" className="block text-sm font-medium text-text-primary mb-2">
          Matric Number
        </label>
        <input
          id="matric_number"
          name="matric_number"
          type="text"
          placeholder="e.g. CSC/2021/001"
          autoComplete="off"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div>
        <label htmlFor="date_of_birth" className="block text-sm font-medium text-text-primary mb-2">
          Date of Birth
        </label>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          required
          className="w-full rounded-xl border-2 border-border bg-surface px-4 py-3 text-sm focus:outline-none focus:border-primary transition-colors"
        />
        {state?.error && (
          <p className="text-xs text-danger mt-2 text-center">{state.error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full flex items-center justify-center gap-2 py-3.5 bg-primary text-white text-sm font-semibold rounded-2xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? <><Loader2 size={16} className="animate-spin" /> Checking…</>
          : <><ArrowRight size={16} /> View My Results</>
        }
      </button>
    </form>
  )
}
```

- [ ] **Step 6: Create `/{slug}/login`**

Create `app/(auth)/[slug]/login/page.js`:

```jsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { LoginForm } from '../../login/LoginForm'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Sign In' }

export default async function UniversityLoginPage({ params, searchParams }) {
  const { slug } = await params
  const adminClient = createAdminClient()
  const { data: university } = await adminClient
    .from('universities')
    .select('id, name, logo_url, primary_color')
    .eq('subdomain', slug.toLowerCase())
    .maybeSingle()

  if (!university) notFound()

  return (
    <div style={getUniversityThemeStyle(university)}>
      <UniversityBadge university={university} />
      <LoginForm searchParams={searchParams} universitySlug={slug.toLowerCase()} />
    </div>
  )
}
```

- [ ] **Step 7: Create `/{slug}/forgot-password`**

Create `app/(auth)/[slug]/forgot-password/page.js`:

```jsx
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ForgotPasswordForm } from '../../forgot-password/ForgotPasswordForm'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Reset Password' }

export default async function UniversityForgotPasswordPage({ params }) {
  const { slug } = await params
  const adminClient = createAdminClient()
  const { data: university } = await adminClient
    .from('universities')
    .select('id, name, logo_url, primary_color')
    .eq('subdomain', slug.toLowerCase())
    .maybeSingle()

  if (!university) notFound()

  return (
    <div style={getUniversityThemeStyle(university)}>
      <UniversityBadge university={university} />
      <ForgotPasswordForm universitySlug={slug.toLowerCase()} />
    </div>
  )
}
```

- [ ] **Step 8: Create `/check-result/{slug}`**

Read the full current `app/check-result/page.js` (after Step 2's edit) before writing this, so the dual-mode structure is mirrored exactly rather than approximated. Create `app/check-result/[slug]/page.js`:

```jsx
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CheckResultForm } from '../CheckResultForm'
import { CheckAnotherResultButton } from '../CheckAnotherResultButton'
import { ResultsList } from '@/components/student/ResultsList'
import { UniversityBadge } from '@/components/shared/UniversityBadge'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export const metadata = { title: 'Check Result — OEMS' }

export default async function UniversityCheckResultPage({ params }) {
  const { slug } = await params
  const adminClient = createAdminClient()
  const { data: university } = await adminClient
    .from('universities')
    .select('id, name, logo_url, primary_color')
    .eq('subdomain', slug.toLowerCase())
    .maybeSingle()

  if (!university) notFound()

  const themeStyle = getUniversityThemeStyle(university)
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  const isResultLookupSession = authUser?.app_metadata?.session_channel === 'result_lookup'

  if (!isResultLookupSession) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-16" style={themeStyle}>
        <div className="w-full max-w-sm">
          <UniversityBadge university={university} />
          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Check Your Result</h1>
            <p className="text-sm text-text-muted mt-1">
              Enter your matric number and date of birth
            </p>
          </div>
          <CheckResultForm universitySlug={slug.toLowerCase()} />
        </div>
      </div>
    )
  }

  const user = await requireRole('student')

  const { data: results } = await supabase
    .from('results')
    .select(`
      final_score, passed,
      exams:exam_id (
        id, title, exam_type,
        courses!course_id ( course_code, course_title ),
        exam_questions ( marks )
      ),
      attempts:attempt_id ( submitted_at )
    `)
    .eq('student_id', user.id)
    .order('attempts(submitted_at)', { ascending: false })

  const enriched = (results ?? []).map(r => {
    const totalMarks = (r.exams?.exam_questions ?? []).reduce((s, q) => s + (q.marks ?? 0), 0)
    const pct = totalMarks > 0 ? Math.round((r.final_score / totalMarks) * 100) : 0
    return { ...r, totalMarks, pct }
  })

  return (
    <div className="flex-1 px-4 py-16" style={themeStyle}>
      <ResultsList user={user} results={enriched} />
      <div className="text-center">
        <CheckAnotherResultButton />
      </div>
    </div>
  )
}
```

- [ ] **Step 9: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS.

Run: `npx next build`
Expected: builds cleanly. This is the first point where the `[slug]` dynamic segment shared between `app/(auth)/[slug]/login` and `app/(auth)/[slug]/forgot-password` gets compiled — watch specifically for any Next.js routing error about conflicting dynamic segment names before moving on to Task 4. If one appears, stop and report it rather than guessing a workaround; it would mean the "slug before" routing decision needs revisiting.

- [ ] **Step 10: Commit**

```bash
git add components/shared/UniversityBadge.js components/student/ResultsList.js \
  app/check-result/page.js "app/(auth)/login/LoginForm.js" "app/(auth)/forgot-password/ForgotPasswordForm.js" \
  app/check-result/CheckResultForm.js \
  "app/(auth)/[slug]/login/page.js" "app/(auth)/[slug]/forgot-password/page.js" "app/check-result/[slug]/page.js"
git commit -m "feat: add university-branded /{slug}/login, /{slug}/forgot-password, /check-result/{slug}"
```

---

### Task 4: `proxy.js` public-path changes

**Files:**
- Modify: `proxy.js`

**Interfaces:**
- Consumes: nothing new — this task only changes route-visibility rules for routes Task 3 already created.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Modify `proxy.js`**

Current full file is 59 lines (already read fresh — reproduced here for the exact diff). Replace the top constant block and the `isPublicPath` computation:

```js
import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/forgot-password', '/dev']
// /check-result and /lab both have dynamic sub-routes that each carry their
// own gate further down (requireRole('student'), or the unauthenticated-safe
// admin-client lookup + notFound() pattern) — the proxy layer only needs to
// avoid blocking unauthenticated visitors, so both match as a prefix, not an
// exact path. /check-result was previously exact-only; moved here so
// /check-result/{slug} (university-scoped result lookup) is also public.
const PREFIX_PUBLIC_PATHS = ['/lab', '/check-result']
// Matches /{slug}/login and /{slug}/forgot-password — the university-branded
// entry points. Unlike /lab and /check-result, these belong in the same
// bucket as plain /login/forgot-password below: an already-authenticated
// visitor who lands on one should be redirected to their own dashboard, not
// stay on a sign-in page.
const UNIVERSITY_AUTH_PATH = /^\/[a-z0-9-]+\/(login|forgot-password)$/

const ROLE_HOME = {
  super_admin:  '/super-admin/dashboard',
  school_admin: '/admin/dashboard',
  lecturer:     '/lecturer/dashboard',
  student:      '/lab',
}

export async function proxy(request) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPrefixPublicPath = PREFIX_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  const isPublicAuthPath   = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) || UNIVERSITY_AUTH_PATH.test(pathname)
  const isPublicPath       = isPublicAuthPath || isPrefixPublicPath

  // No session — redirect to login, preserving the intended destination
  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Authenticated user visiting a public auth page (/login, /forgot-password,
  // /dev, or a /{slug} variant of the first two) — send to their dashboard.
  // Role is read from user_metadata (set on signup) to avoid a DB call here.
  //
  // /lab and /check-result are deliberately excluded: they must stay
  // reachable even with a session already present, so a student can sign
  // out-and-back-in or enter a second exam without being bounced first.
  if (user && isPublicAuthPath) {
    const role = user.user_metadata?.role
    const home = ROLE_HOME[role] ?? '/login'
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = home
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Note `EXACT_PUBLIC_PATHS` is fully removed (its one member, `/check-result`, moved into `PREFIX_PUBLIC_PATHS`) and `isExactPublicPath` is no longer referenced anywhere.

- [ ] **Step 2: Manual verification**

This file has no dedicated test suite (it's Next.js middleware, not covered by this project's Vitest setup — same as before this task). Run `npm run dev` and check by hand:
1. Visit `/pcu/login` (or whatever slug you seeded in Task 3's manual testing) while signed out — should render the login form, not redirect to `/login`.
2. While signed in as a lecturer, visit `/pcu/login` directly — should redirect to `/lecturer/dashboard`.
3. Visit `/check-result/pcu` while signed out — should render the check-result form.
4. Confirm `/login`, `/forgot-password`, `/check-result`, `/lab` all still behave exactly as before (reachable signed-out; the first two redirect away if already signed in, the last two don't).

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS.

Run: `npx next build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add proxy.js
git commit -m "feat: recognize university-branded auth paths and /check-result/{slug} as public in proxy.js"
```

---

### Task 5: Theme the authenticated app

**Files:**
- Modify: `app/lecturer/layout.js`
- Modify: `app/admin/layout.js`
- Modify: `components/shared/Sidebar.js`

**Interfaces:**
- Consumes: `getUniversityThemeStyle` from `lib/universityTheme.js` (Task 1).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Update `app/lecturer/layout.js`**

Replace the full file:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shared/Sidebar'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export default async function LecturerLayout({ children }) {
  const user     = await requireRole('lecturer')
  const supabase = await createClient()

  const { data: university } = await supabase
    .from('universities')
    .select('primary_color, logo_url')
    .eq('id', user.university_id)
    .maybeSingle()

  return (
    <div className="flex h-screen overflow-hidden" style={getUniversityThemeStyle(university)}>
      <Sidebar user={user} logoUrl={university?.logo_url} />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/admin/layout.js`**

Replace the full file, same pattern:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/shared/Sidebar'
import { getUniversityThemeStyle } from '@/lib/universityTheme'

export default async function AdminLayout({ children }) {
  const user     = await requireRole('school_admin')
  const supabase = await createClient()

  const { data: university } = await supabase
    .from('universities')
    .select('primary_color, logo_url')
    .eq('id', user.university_id)
    .maybeSingle()

  return (
    <div className="flex h-screen overflow-hidden" style={getUniversityThemeStyle(university)}>
      <Sidebar user={user} logoUrl={university?.logo_url} />
      <div className="flex flex-col flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {children}
      </div>
    </div>
  )
}
```

`app/super-admin/layout.js` is **not modified** — super admins are platform-wide (`university_id` is `NULL`), so there's no university to theme from.

- [ ] **Step 3: Update `Sidebar.js` to show a logo**

The brand mark appears three times in this file (desktop `aside`, mobile top bar, mobile drawer) — extract one small local (not exported) component so the logo-or-icon logic lives in one place, used in all three spots. Replace the full file:

```jsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, BookOpen, ClipboardList,
  BarChart2, GraduationCap, Building2, Settings,
  FileQuestion, ScrollText, LogOut, Menu, X, History,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'

const NAV = {
  super_admin: [
    { label: 'Dashboard',    href: '/super-admin/dashboard',    icon: LayoutDashboard },
    { label: 'Universities', href: '/super-admin/universities', icon: Building2 },
    { label: 'All Users',    href: '/super-admin/users',        icon: Users },
    { label: 'Logs',         href: '/super-admin/logs',         icon: History },
    { label: 'Settings',     href: '/super-admin/settings',     icon: Settings },
  ],
  school_admin: [
    { label: 'Dashboard',         href: '/admin/dashboard',  icon: LayoutDashboard },
    { label: 'Users',             href: '/admin/users',       icon: Users },
    { label: 'Faculties & Depts', href: '/admin/structure',   icon: Building2 },
    { label: 'Courses',           href: '/admin/courses',     icon: BookOpen },
    { label: 'Exam Oversight',    href: '/admin/exams',       icon: ClipboardList },
    { label: 'Logs',              href: '/admin/logs',        icon: History },
  ],
  lecturer: [
    { label: 'Dashboard',     href: '/lecturer/dashboard', icon: LayoutDashboard },
    { label: 'Question Bank', href: '/lecturer/questions', icon: FileQuestion },
    { label: 'Exams',         href: '/lecturer/exams',     icon: ScrollText },
    { label: 'Results',       href: '/lecturer/results',   icon: BarChart2 },
  ],
}

const ROLE_LABEL = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer Portal',
}

// Shows a university's own logo in place of the generic icon when one is
// set — same "only if set" pattern as the color theming; a university with
// no logo_url renders exactly as before.
function BrandIcon({ logoUrl, size }) {
  if (logoUrl) {
    return <img src={logoUrl} alt="" className={`size-${size} rounded-lg object-cover`} />
  }
  return <GraduationCap className={`size-${size === 8 ? 5 : 4} text-white`} />
}

function NavLinks({ items, pathname, onNavigate }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      {items.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={[
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-white/15 text-white'
                : 'text-white/65 hover:bg-white/10 hover:text-white',
            ].join(' ')}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function UserFooter({ user }) {
  return (
    <div className="px-3 py-4 border-t border-white/10">
      <div className="px-3 py-2 mb-1">
        <p className="text-sm font-medium text-white truncate">{user.full_name}</p>
        {/* Students authenticate credential-less; their email is a synthetic
            internal address (<matric>@<uni-id>.students.oems.internal) that
            is implementation plumbing and must never be shown to them. */}
        {user.role !== 'student' && (
          <p className="text-xs text-white/55 truncate">{user.email}</p>
        )}
        {user.matric_number && (
          <p className="text-xs font-mono text-white/45 mt-0.5">{user.matric_number}</p>
        )}
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/65 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="size-4 shrink-0" />
          Sign out
        </button>
      </form>
    </div>
  )
}

export function Sidebar({ user, logoUrl }) {
  const pathname   = usePathname()
  const [open, setOpen] = useState(false)
  const items      = NAV[user.role] ?? []
  const roleLabel  = ROLE_LABEL[user.role] ?? 'Portal'

  // Close drawer on route change
  useEffect(() => { setOpen(false) }, [pathname])

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 bg-primary h-full">
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <BrandIcon logoUrl={logoUrl} size={8} />
            </span>
            <div>
              <p className="text-sm font-bold text-white leading-tight">OEMS</p>
              <p className="text-xs text-white/60 leading-tight">{roleLabel}</p>
            </div>
          </div>
        </div>
        <NavLinks items={items} pathname={pathname} onNavigate={() => {}} />
        <UserFooter user={user} />
      </aside>

      {/* ── Mobile top bar ───────────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 py-3 bg-primary h-14">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-white/15">
            <BrandIcon logoUrl={logoUrl} size={7} />
          </span>
          <span className="text-sm font-bold text-white">OEMS</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* ── Mobile drawer backdrop ───────────────────────────────────────── */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      <aside
        className={[
          'md:hidden fixed inset-y-0 left-0 z-50 w-72 bg-primary flex flex-col',
          'transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
        aria-label="Navigation"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <BrandIcon logoUrl={logoUrl} size={8} />
            </span>
            <div>
              <p className="text-sm font-bold text-white leading-tight">OEMS</p>
              <p className="text-xs text-white/60 leading-tight">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <NavLinks items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
        <UserFooter user={user} />
      </aside>
    </>
  )
}
```

Note: `app/super-admin/layout.js` renders `<Sidebar user={user} />` with no `logoUrl` prop — `BrandIcon` treats `undefined` the same as no logo, so this needs no change there.

- [ ] **Step 2: Manual verification**

No new unit tests — these are page/layout components, and this codebase's established convention (confirmed by every UI-only task so far this session) is to verify these with a clean build plus manual QA, not new automated tests. Run `npm run dev`:
1. Sign in as a lecturer/exam officer at a university with no `primary_color` set — sidebar, buttons, everything should look exactly as it does today (PCU purple).
2. Set a `primary_color` directly via a SQL update for a test university (Task 6 will add the real UI for this) and sign in as a user at that university — confirm the sidebar, active nav item, and buttons all pick up the new color, and confirm white button text stays readable.
3. Set a `logo_url` for that same university — confirm it replaces the `GraduationCap` icon in the sidebar (desktop, mobile bar, mobile drawer).

- [ ] **Step 3: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS.

Run: `npx next build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add app/lecturer/layout.js app/admin/layout.js components/shared/Sidebar.js
git commit -m "feat: theme the authenticated lecturer/exam-officer app with the university's color and logo"
```

---

### Task 6: Super-admin branding configuration UI

**Files:**
- Modify: `lib/actions/admin.js` (`universitySchema`, `createUniversity`, new `updateUniversityBranding`)
- Modify: `lib/actions/admin.test.js`
- Modify: `app/super-admin/universities/CreateUniversityForm.js`
- Modify: `app/super-admin/universities/page.js`
- Create: `app/super-admin/universities/UniversityRow.js`

**Interfaces:**
- Consumes: `isDarkEnoughForWhiteText` from `lib/universityTheme.js` (Task 1).
- Produces: `updateUniversityBranding(universityId: string, prevState, formData): Promise<{ ok: true } | { errors: {...} }>` — used only within this task.

- [ ] **Step 1: Write the failing tests**

Add to `lib/actions/admin.test.js`. First update the import line (currently line 23) to include the two new/existing functions:

```js
import { inviteUser, bulkUploadStudents, toggleUserActive, superAdminToggleUserActive, superAdminRemoveUser, createUniversity, updateUniversityBranding } from './admin'
```

Then add these two new `describe` blocks, after the existing `describe('superAdminRemoveUser', ...)` block (the file's last one):

```js
describe('createUniversity', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('creates a university with no color/logo (both optional)', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({ name: 'University of Lagos', subdomain: 'unilag' }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.insert).toHaveBeenCalledWith({ name: 'University of Lagos', subdomain: 'unilag' })
  })

  it('rejects a primary_color too light for white button text', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient()
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({
      name: 'University of Lagos', subdomain: 'unilag', primary_color: '#F5F5F5',
    }))

    expect(result.errors.primary_color).toBeDefined()
    expect(supabase.from).not.toHaveBeenCalledWith('universities')
  })

  it('accepts a valid primary_color and logo_url', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({
      name: 'University of Lagos', subdomain: 'unilag',
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.insert).toHaveBeenCalledWith({
      name: 'University of Lagos', subdomain: 'unilag',
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    })
  })

  it('maps a duplicate-subdomain Supabase error to a field error', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: { code: '23505' } }] })
    createClient.mockResolvedValue(supabase)

    const result = await createUniversity(undefined, formData({ name: 'Dup', subdomain: 'unilag' }))

    expect(result.errors.subdomain).toEqual(['This subdomain is already taken.'])
  })
})

describe('updateUniversityBranding', () => {
  const superAdmin = { id: 'super-1', role: 'super_admin' }

  it('rejects a primary_color too light for white button text', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient()
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({ primary_color: '#FFFFFF' }))

    expect(result.errors.primary_color).toBeDefined()
    expect(supabase.from).not.toHaveBeenCalledWith('universities')
  })

  it('updates the color and logo for the given university only', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({
      primary_color: '#123456', logo_url: 'https://example.com/logo.png',
    }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.update).toHaveBeenCalledWith({ primary_color: '#123456', logo_url: 'https://example.com/logo.png' })
    expect(universitiesBuilder.eq).toHaveBeenCalledWith('id', 'uni-1')
  })

  it('allows clearing both fields back to unset', async () => {
    requireRole.mockResolvedValue(superAdmin)
    const supabase = createMockSupabaseClient({ universities: [{ data: null, error: null }] })
    createClient.mockResolvedValue(supabase)

    const result = await updateUniversityBranding('uni-1', undefined, formData({ primary_color: '', logo_url: '' }))

    expect(result).toEqual({ ok: true })
    const universitiesBuilder = supabase.from.mock.results.find((r, i) => supabase.from.mock.calls[i][0] === 'universities').value
    expect(universitiesBuilder.update).toHaveBeenCalledWith({ primary_color: null, logo_url: null })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: FAIL — `updateUniversityBranding` isn't exported yet, and `createUniversity` doesn't handle `primary_color`/`logo_url` yet.

- [ ] **Step 3: Implement in `lib/actions/admin.js`**

Add the import at the top of the file (after the existing `import { z } from 'zod'`):

```js
import { isDarkEnoughForWhiteText } from '@/lib/universityTheme'
```

Replace `universitySchema` (currently lines 297–300) with:

```js
const universitySchema = z.object({
  name:      z.string().min(3, 'University name required'),
  subdomain: z.string().min(2, 'Subdomain required').regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, hyphens'),
  primary_color: z.string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid hex color')
    .refine(isDarkEnoughForWhiteText, 'This color is too light for white button text to stay readable — try a darker shade.')
    .optional()
    .or(z.literal('')),
  logo_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
})

const brandingSchema = universitySchema.pick({ primary_color: true, logo_url: true })
```

Replace `createUniversity` (currently lines 302–325) with:

```js
export async function createUniversity(prevState, formData) {
  await requireRole('super_admin')

  const raw = {
    name:          formData.get('name')?.trim(),
    subdomain:     formData.get('subdomain')?.trim().toLowerCase(),
    primary_color: formData.get('primary_color')?.trim() || '',
    logo_url:      formData.get('logo_url')?.trim() || '',
  }

  const parsed = universitySchema.safeParse(raw)
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const payload = {
    name:      parsed.data.name,
    subdomain: parsed.data.subdomain,
    ...(parsed.data.primary_color && { primary_color: parsed.data.primary_color }),
    ...(parsed.data.logo_url      && { logo_url:      parsed.data.logo_url }),
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('universities')
    .insert(payload)

  if (error) {
    if (error.code === '23505') return { errors: { subdomain: ['This subdomain is already taken.'] } }
    return { errors: { _form: error.message } }
  }

  revalidatePath('/super-admin/universities')
  return { ok: true }
}

export async function updateUniversityBranding(universityId, prevState, formData) {
  await requireRole('super_admin')

  const raw = {
    primary_color: formData.get('primary_color')?.trim() || '',
    logo_url:      formData.get('logo_url')?.trim() || '',
  }

  const parsed = brandingSchema.safeParse(raw)
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors }

  const supabase = await createClient()
  const { error } = await supabase
    .from('universities')
    .update({
      primary_color: parsed.data.primary_color || null,
      logo_url:      parsed.data.logo_url      || null,
    })
    .eq('id', universityId)

  if (error) return { errors: { _form: error.message } }

  revalidatePath('/super-admin/universities')
  return { ok: true }
}
```

Note the test's exact-payload assertions: the "creates a university with no color/logo" test expects `insert` called with just `{ name, subdomain }` (no color/logo keys at all when both are empty strings) — the spread-conditional in `createUniversity` above produces exactly that. The "accepts a valid primary_color and logo_url" test expects both keys present when both are provided — also matches.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/actions/admin.test.js`
Expected: PASS — all tests green, including every pre-existing test in this file.

- [ ] **Step 5: Add color/logo inputs to `CreateUniversityForm`**

Replace the full file:

```jsx
'use client'

import { useActionState, useState } from 'react'
import { Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { createUniversity } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function CreateUniversityForm() {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState(createUniversity, null)

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-primary hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2"><Plus size={14} /> Add University</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <form action={formAction} className="px-4 pb-4 space-y-3 border-t border-border bg-page">
          <Input
            id="uni_name" name="name" label="University Name"
            placeholder="University of Lagos" required
            error={state?.errors?.name?.[0]}
          />
          <Input
            id="subdomain" name="subdomain" label="Subdomain"
            placeholder="unilag"
            hint="Lowercase letters, numbers, hyphens only — e.g. unilag, ui, abu. Becomes their /{subdomain}/login link."
            required
            error={state?.errors?.subdomain?.[0]}
          />
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="primary_color" className="block text-sm font-medium text-text-primary mb-1.5">
                Brand color <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                id="primary_color" name="primary_color" type="color" defaultValue="#3A0A5E"
                className="h-10 w-16 rounded-lg border border-border cursor-pointer"
              />
            </div>
            {state?.errors?.primary_color?.[0] && (
              <p className="text-sm text-danger">{state.errors.primary_color[0]}</p>
            )}
          </div>
          <Input
            id="logo_url" name="logo_url" label="Logo URL"
            placeholder="https://example.com/logo.png"
            hint="Optional — a link to an already-hosted image."
            error={state?.errors?.logo_url?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">University created successfully.</p>}
          <SubmitButton loadingText="Creating…" className="w-full">Create University</SubmitButton>
        </form>
      )}
    </div>
  )
}
```

Note: the native `<input type="color">` always has a value (browsers default it to `#000000` if untouched) — it can never submit an empty string, so `primary_color` is effectively required once this input is touched. That's fine given `defaultValue="#3A0A5E"` — a super admin who doesn't care leaves it at that default, which happens to already equal PCU's own hardcoded color, so the derived shades exactly reproduce today's look even though the field is technically "set." Someone who genuinely wants no override at all can still get it via `updateUniversityBranding`'s clear-to-empty path (Step 6) since that form uses a text input, not a color picker.

- [ ] **Step 6: Add inline branding edit to the universities list**

Create `app/super-admin/universities/UniversityRow.js`:

```jsx
'use client'

import { useActionState, useState } from 'react'
import { Building2, Pencil } from 'lucide-react'
import { updateUniversityBranding } from '@/lib/actions/admin'
import { Input } from '@/components/ui/Input'
import { SubmitButton } from '@/components/ui/Button'

export function UniversityRow({ university, counts }) {
  const [editing, setEditing] = useState(false)
  const updateAction = updateUniversityBranding.bind(null, university.id)
  const [state, formAction] = useActionState(updateAction, null)

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary-light shrink-0 overflow-hidden">
            {university.logo_url
              ? <img src={university.logo_url} alt="" className="size-full object-cover" />
              : <Building2 size={18} className="text-primary" />
            }
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{university.name}</p>
            <p className="text-xs font-mono text-text-muted">{university.subdomain}.oems.edu</p>
          </div>
        </div>
        <div className="flex items-center gap-6 text-center shrink-0">
          <div>
            <p className="text-lg font-bold text-text-primary tabular-nums">{counts.lecturers}</p>
            <p className="text-xs text-text-muted">Lecturers</p>
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary tabular-nums">{counts.students}</p>
            <p className="text-xs text-text-muted">Students</p>
          </div>
          <div>
            <p className="text-lg font-bold text-text-primary tabular-nums">{counts.total}</p>
            <p className="text-xs text-text-muted">Total Users</p>
          </div>
          <button
            onClick={() => setEditing(v => !v)}
            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-slate-50 transition-colors"
            title="Edit branding"
          >
            <Pencil size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <form action={formAction} className="mt-4 pt-4 border-t border-border space-y-3">
          <div>
            <label htmlFor={`primary_color_${university.id}`} className="block text-sm font-medium text-text-primary mb-1.5">
              Brand color <span className="text-text-muted font-normal">(leave blank to use the default)</span>
            </label>
            <input
              id={`primary_color_${university.id}`} name="primary_color" type="text"
              defaultValue={university.primary_color ?? ''}
              placeholder="#3A0A5E"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {state?.errors?.primary_color?.[0] && (
              <p className="text-xs text-danger mt-1">{state.errors.primary_color[0]}</p>
            )}
          </div>
          <Input
            id={`logo_url_${university.id}`} name="logo_url" label="Logo URL"
            defaultValue={university.logo_url ?? ''}
            placeholder="https://example.com/logo.png"
            error={state?.errors?.logo_url?.[0]}
          />
          {state?.errors?._form && <p className="text-sm text-danger">{state.errors._form}</p>}
          {state?.ok && <p className="text-sm text-success">Branding updated.</p>}
          <SubmitButton loadingText="Saving…" className="w-full">Save Branding</SubmitButton>
        </form>
      )}
    </div>
  )
}
```

Modify `app/super-admin/universities/page.js`: change the `select` to include the two new columns, and replace the inline row `<div>` with `<UniversityRow>`:

```jsx
import { requireRole } from '@/lib/dal'
import { createClient } from '@/lib/supabase/server'
import { TopBar } from '@/components/shared/TopBar'
import { CreateUniversityForm } from './CreateUniversityForm'
import { UniversityRow } from './UniversityRow'
import { Building2 } from 'lucide-react'

export const metadata = { title: 'Universities — OEMS' }

export default async function SuperAdminUniversitiesPage() {
  await requireRole('super_admin')
  const supabase = await createClient()

  const { data: universities } = await supabase
    .from('universities')
    .select('id, name, subdomain, primary_color, logo_url, created_at')
    .order('name')

  // Count users per university
  const uniIds = (universities ?? []).map(u => u.id)
  const { data: userCounts } = uniIds.length
    ? await supabase
        .from('users')
        .select('university_id, role')
        .in('university_id', uniIds)
    : { data: [] }

  const countMap = {}
  for (const u of userCounts ?? []) {
    if (!countMap[u.university_id]) countMap[u.university_id] = { total: 0, students: 0, lecturers: 0 }
    countMap[u.university_id].total++
    if (u.role === 'student') countMap[u.university_id].students++
    if (u.role === 'lecturer') countMap[u.university_id].lecturers++
  }

  return (
    <>
      <TopBar
        title="Universities"
        subtitle={`${universities?.length ?? 0} institution${universities?.length !== 1 ? 's' : ''} on the platform`}
      />
      <main className="flex-1 p-6 max-w-4xl space-y-6">
        <CreateUniversityForm />

        {!universities?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
            <Building2 size={32} className="text-text-muted mb-3" />
            <p className="text-sm font-medium text-text-primary mb-1">No universities yet</p>
            <p className="text-xs text-text-muted">Add your first institution above.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {universities.map(uni => (
              <UniversityRow
                key={uni.id}
                university={uni}
                counts={countMap[uni.id] ?? { total: 0, students: 0, lecturers: 0 }}
              />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS.

Run: `npx next build`
Expected: builds cleanly.

- [ ] **Step 8: Commit**

```bash
git add lib/actions/admin.js lib/actions/admin.test.js \
  app/super-admin/universities/CreateUniversityForm.js \
  app/super-admin/universities/page.js app/super-admin/universities/UniversityRow.js
git commit -m "feat: add university branding configuration to super-admin Universities screen"
```

---

### Task 7: Exam Officer link-discovery card

**Files:**
- Create: `components/admin/SignInLinkCard.js`
- Modify: `app/admin/dashboard/page.js`

**Interfaces:**
- Consumes: nothing from earlier tasks directly — reads `NEXT_PUBLIC_SITE_URL` (already used elsewhere in the codebase, e.g. `forgotPassword` in `lib/actions/auth.js`) and the university's own `subdomain`.
- Produces: nothing for later tasks — this is the last task in the plan.

- [ ] **Step 1: Create the copy-link card**

Create `components/admin/SignInLinkCard.js`:

```jsx
'use client'

import { useState } from 'react'
import { Copy, Check, Link2 } from 'lucide-react'

export function SignInLinkCard({ url }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-1.5">
        <Link2 size={14} className="text-primary" />
        Your Staff Sign-In Link
      </h2>
      <p className="text-xs text-text-muted mb-3">
        Share this with your lecturers — it shows your institution's own branding on the sign-in page.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-page border border-border rounded-lg px-3 py-2 text-text-secondary">
          {url}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs font-medium text-text-secondary hover:bg-slate-50 transition-colors"
        >
          {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add it to the dashboard**

Modify `app/admin/dashboard/page.js`: add a query for the exam officer's own `subdomain`, and render the card in the right column.

Add to the existing `Promise.all` array (after `{ data: closedExams }`):

```js
    supabase.from('universities').select('subdomain').eq('id', user.university_id).maybeSingle(),
```

Update the destructuring on the `Promise.all` line to add `{ data: university }` matching that new position, and build the URL after the existing `deptMap`/`enrichedDepts`/pass-rate computations:

```js
  const siteUrl   = process.env.NEXT_PUBLIC_SITE_URL || ''
  const signInUrl = university?.subdomain ? `${siteUrl}/${university.subdomain}/login` : null
```

Add the import: `import { SignInLinkCard } from '@/components/admin/SignInLinkCard'`.

In the "Right col" `<div className="space-y-5">`, add the card as the first child (above "Result health"), only when `signInUrl` is available:

```jsx
{signInUrl && <SignInLinkCard url={signInUrl} />}
```

- [ ] **Step 3: Manual verification**

No dedicated test for this page (same established convention as every other dashboard task this session — server component with no existing test coverage). Run `npm run dev`, sign in as an exam officer, confirm the card shows the correct `/{their-subdomain}/login` URL and the copy button works.

- [ ] **Step 4: Run the full suite and build**

Run: `npx vitest run`
Expected: PASS.

Run: `npx next build`
Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
git add components/admin/SignInLinkCard.js app/admin/dashboard/page.js
git commit -m "feat: show the exam officer their own university's branded sign-in link"
```
