# PCU Rebrand + Hide Remote Exam Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand OEMS to Precious Cornerstone University's visual identity and hide the multi-tenant framing, and hide the remote exam-delivery option so lecturers can only create lab-based exams.

**Architecture:** Both are pure UI/config surface changes — theme tokens, fonts, copy, and one nav entry for the rebrand; a Zod default and a form section removal for hiding remote mode. No schema, server action, or business-logic changes in either task.

**Tech Stack:** Next.js 16 (`next/font/google`), Tailwind CSS v4 (`@theme` tokens in `app/globals.css`), React Hook Form + Zod.

## Global Constraints

- Rebrand touches only theme tokens, fonts, copy, and the super-admin nav — the `universities` route and schema stay fully intact, this is a visibility change, not a removal. (spec: §1)
- Product name stays "OEMS" — do not rename it. (spec: §1)
- Hiding remote mode touches only the Zod default and the settings form UI — the `exam_mode` column, the `'remote'` enum value, and any code that already treats both modes identically stay untouched. (spec: §2)
- No new automated tests for either task — both are pure UI/config, verified via `npx next build` plus a manual look, matching how the UI-only task earlier in this session was verified. (spec: Testing)

---

### Task 1: PCU rebrand — theme, fonts, copy, nav

**Files:**
- Modify: `app/globals.css:1-36` (theme tokens)
- Modify: `app/globals.css` (add a heading font-family rule after the existing `body` rule, currently ending at line 53)
- Modify: `app/layout.js` (whole file — font loading + metadata)
- Modify: `README.md:1-5` (title/tagline)
- Modify: `components/shared/Sidebar.js:14-19` (remove the "Universities" nav entry)

**Interfaces:**
- Produces: `--font-serif` CSS custom property (new), `--color-accent` and `--color-gold` CSS custom properties (new) — available to any component that wants PCU's secondary brand colors later, though nothing in this task consumes them beyond the token definition itself.

- [ ] **Step 1: Update the theme tokens in `app/globals.css`**

Replace the `@theme { ... }` block (lines 4-36) — the primary/accent colors change, everything else (surfaces, semantic colors, text hierarchy) stays exactly as-is:

```css
@theme {
  /* Typography — Inter (body) + Playfair Display (headings), loaded via
     next/font in layout.js — matches Precious Cornerstone University's own
     site (pcu.edu.ng). */
  --font-sans:  var(--font-inter);
  --font-serif: var(--font-playfair);
  --font-mono:  var(--font-geist-mono);

  /* Primary — PCU Deep Purple
     Used for: primary buttons, active nav items, key headings.
     Matches Precious Cornerstone University's brand (pcu.edu.ng). */
  --color-primary:       #3A0A5E;
  --color-primary-light: #F3E8FF;
  --color-primary-hover: #2C0747;

  /* Accent — PCU Red + Gold
     Secondary brand colors, for CTAs and highlights. */
  --color-accent: #B91C1C;
  --color-gold:   #EAB308;

  /* Surfaces
     Background is slate-100, not white — reduces eye strain during long exam sessions. */
  --color-surface:     #FFFFFF;
  --color-page:        #F1F5F9;
  --color-border:      #E2E8F0;
  --color-border-focus:#94A3B8;

  /* Semantic — always paired with icon + text, never color alone */
  --color-success:       #16A34A;
  --color-success-light: #F0FDF4;
  --color-danger:        #DC2626;
  --color-danger-light:  #FEF2F2;
  --color-warning:       #D97706;
  --color-warning-light: #FFFBEB;

  /* Text hierarchy */
  --color-text-primary:   #0F172A;
  --color-text-secondary: #475569;
  --color-text-muted:     #94A3B8;
  --color-text-on-primary:#FFFFFF;
}
```

- [ ] **Step 2: Add the heading font-family rule**

Find the existing `body { ... }` rule in `app/globals.css` (currently lines 48-53):

```css
body {
  background-color: var(--color-page);
  color: var(--color-text-primary);
  font-family: var(--font-sans), system-ui, sans-serif;
  line-height: 1.6;
}
```

Leave it exactly as-is, and add this new rule immediately after it (before the `/* Monospace for matric numbers and course codes */` comment):

```css

/* Headings use Playfair Display, matching Precious Cornerstone University's site */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif), Georgia, 'Times New Roman', serif;
}
```

- [ ] **Step 3: Replace the font loading and metadata in `app/layout.js`**

Replace the entire file with:

```js
import { Inter, Playfair_Display, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  weight: ['600', '700'],
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata = {
  title: {
    template: '%s — OEMS',
    default: 'OEMS — Precious Cornerstone University CBT Platform',
  },
  description: 'Computer-Based Test platform built for Precious Cornerstone University.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${geistMono.variable} h-full overflow-hidden`}>
      <body className="h-full overflow-hidden">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: 'var(--font-inter)',
              fontSize: '14px',
            },
          }}
        />
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Update the README title and tagline**

In `README.md`, change lines 1-5 from:

```markdown
# OEMS — Online Examination Management System

A full-stack, multi-tenant Computer-Based Test (CBT) platform built for Nigerian universities. Covers the complete exam lifecycle from question authoring to result publication, with role-scoped access for every stakeholder.

> Academic Research Project · Next.js 16 · Supabase · Tailwind CSS v4
```

to:

```markdown
# OEMS — Online Examination Management System

A full-stack Computer-Based Test (CBT) platform built for Precious Cornerstone University (PCU), Ibadan. Covers the complete exam lifecycle from question authoring to result publication, with role-scoped access for every stakeholder.

> Academic Research Project · Precious Cornerstone University · Next.js 16 · Supabase · Tailwind CSS v4
```

- [ ] **Step 5: Remove "Universities" from the super-admin nav**

In `components/shared/Sidebar.js`, change the `super_admin` array (lines 14-19) from:

```js
  super_admin: [
    { label: 'Dashboard',    href: '/super-admin/dashboard',   icon: LayoutDashboard },
    { label: 'Universities', href: '/super-admin/universities', icon: Building2 },
    { label: 'All Users',    href: '/super-admin/users',        icon: Users },
    { label: 'Settings',     href: '/super-admin/settings',     icon: Settings },
  ],
```

to:

```js
  super_admin: [
    { label: 'Dashboard', href: '/super-admin/dashboard', icon: LayoutDashboard },
    { label: 'All Users', href: '/super-admin/users',     icon: Users },
    { label: 'Settings',  href: '/super-admin/settings',  icon: Settings },
  ],
```

Do not remove the `Building2` import (top of file) — it's still used by the `school_admin` nav's "Faculties & Depts" entry two lines below.

- [ ] **Step 6: Build check**

Run: `npx next build`
Expected: compiles with no errors (Google Fonts `Inter` and `Playfair_Display` are both valid `next/font/google` exports, so this should resolve cleanly same as the existing `Plus_Jakarta_Sans`/`Geist_Mono` did).

- [ ] **Step 7: Manual check**

Run: `npm run dev`, open the app in a browser, and confirm:
- Headings render in a serif typeface (Playfair Display), body text in Inter.
- Primary UI elements (sidebar, primary buttons) are deep purple, not navy.
- Logging in as `super_admin` shows no "Universities" link in the sidebar.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css app/layout.js README.md components/shared/Sidebar.js
git commit -m "feat: rebrand to Precious Cornerstone University identity, hide multi-tenant nav"
```

---

### Task 2: Hide remote exam mode

**Files:**
- Modify: `lib/validations/exams.js:32`
- Modify: `components/exams/ExamSettingsForm.js` (Delivery Mode section, imports, `examMode` variable, `defaultValues`, `onSubmit` payload, `ModeCard` helper)

**Interfaces:**
- Consumes: nothing from Task 1 — fully independent.

- [ ] **Step 1: Change the Zod default**

In `lib/validations/exams.js`, line 32, change:

```js
  exam_mode:           z.enum(['remote', 'lab']).default('remote'),
```

to:

```js
  exam_mode:           z.enum(['remote', 'lab']).default('lab'),
```

- [ ] **Step 2: Remove the unused icon imports**

In `components/exams/ExamSettingsForm.js`, change the icon import (lines 14-17) from:

```js
import {
  Wifi, Monitor, Camera, Calculator, Lightbulb,
  Plus, Trash2, Info,
} from 'lucide-react'
```

to:

```js
import {
  Calculator, Lightbulb,
  Plus, Trash2, Info,
} from 'lucide-react'
```

(`Wifi`, `Monitor`, and `Camera` were only used inside the Delivery Mode/proctoring section removed in the next step. `Info` stays — it's reused in Step 4's replacement block.)

- [ ] **Step 3: Update the form's default values**

In the same file, change the `exam_mode` default in the create-mode branch (currently line 56) from:

```js
          exam_mode:           'remote',
```

to:

```js
          exam_mode:           'lab',
```

And change the edit-mode fallback (currently line 44) from:

```js
          exam_mode:           exam.exam_mode ?? 'remote',
```

to:

```js
          exam_mode:           exam.exam_mode ?? 'lab',
```

(This only affects the fallback used if an existing exam's `exam_mode` were ever null, which the database's `NOT NULL DEFAULT` prevents in practice — kept in sync with the new default for consistency, not because it's reachable.)

Remove the now-unused `examMode` variable — change:

```js
  const examMode = watch('exam_mode')
```

Delete this line entirely (it's currently on its own line, right before the `async function onSubmit(data) {` block).

- [ ] **Step 4: Replace the Delivery Mode section**

Replace the entire `{/* ── Delivery mode ── */}` section (currently the block starting `<section className="bg-surface border border-border rounded-xl p-6 space-y-5">` right after the Timing & Scoring section, and ending at the `</section>` before `{/* ── Options ── */}`) — the full current block being replaced is:

```jsx
      {/* ── Delivery mode ───────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Delivery Mode</h2>
          <p className="text-sm text-text-muted mt-1">
            Choose how students will access and sit this exam.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ModeCard
            id="mode-remote"
            value="remote"
            icon={Wifi}
            title="Remote"
            description="Students take the exam from any location using their own devices. Optional webcam proctoring available."
            selected={examMode === 'remote'}
            registerProps={register('exam_mode')}
          />
          <ModeCard
            id="mode-lab"
            value="lab"
            icon={Monitor}
            title="Computer Lab"
            description="All students sit together in a lab. A lab code links every machine directly to this exam — no navigation, just the exam."
            selected={examMode === 'lab'}
            registerProps={register('exam_mode')}
          />
        </div>

        {/* Proctoring — remote only */}
        {examMode === 'remote' && (
          <div className="border border-border rounded-xl p-4 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded accent-primary"
                {...register('proctoring_enabled')}
              />
              <div>
                <div className="flex items-center gap-2">
                  <Camera size={15} className="text-text-muted" />
                  <span className="text-sm font-medium text-text-primary">Enable webcam proctoring</span>
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  The student's webcam is activated during the exam. Random photos are taken at irregular intervals (every 2–8 minutes) and stored for your review. Students are informed before starting.
                </p>
              </div>
            </label>
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <Info size={13} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Requires students to grant camera permission in their browser. If denied, they will see a warning but can still continue.
              </p>
            </div>
          </div>
        )}

        {examMode === 'lab' && (
          <div className="flex items-start gap-2 bg-primary-light border border-primary/20 rounded-lg px-3 py-2.5">
            <Info size={13} className="text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-primary/80">
              After saving, go to the exam detail page to generate a <strong>lab code</strong>. Display the URL <code className="bg-primary/10 px-1 rounded">oems.edu.ng/lab/[CODE]</code> on a projector or enter it on each lab machine. Students see only the exam interface — no sidebar, no navigation.
            </p>
          </div>
        )}
      </section>
```

Replace it with this simplified, unconditional block — the lab-code guidance is genuinely useful and is kept; the mode selector and remote/proctoring UI are gone since there is no longer a choice to make:

```jsx
      {/* ── Delivery ─────────────────────────────────────────────────────────── */}
      <section className="bg-surface border border-border rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-text-primary">Delivery</h2>
        <div className="flex items-start gap-2 bg-primary-light border border-primary/20 rounded-lg px-3 py-2.5">
          <Info size={13} className="text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-primary/80">
            After saving, go to the exam detail page to generate an <strong>access code</strong>. Display it on a projector or share it with students in the lab — they enter it with their matric number to begin. No navigation, just the exam.
          </p>
        </div>
      </section>
```

- [ ] **Step 5: Simplify the `onSubmit` payload**

In the same file, change the `proctoring_enabled` line inside `onSubmit` (currently):

```js
      // Lab mode never has proctoring
      proctoring_enabled: data.exam_mode === 'remote' ? data.proctoring_enabled : false,
```

to:

```js
      // Proctoring UI has been retired — every exam is lab-delivered now.
      proctoring_enabled: false,
```

- [ ] **Step 6: Remove the now-unused `ModeCard` helper**

At the bottom of the file, delete the entire `ModeCard` function definition:

```js
function ModeCard({ id, value, icon: Icon, title, description, selected, registerProps }) {
  return (
    <label
      htmlFor={id}
      className={[
        'flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all',
        selected
          ? 'border-primary bg-primary-light'
          : 'border-border bg-surface hover:border-primary/30',
      ].join(' ')}
    >
      <input type="radio" id={id} value={value} className="sr-only" {...registerProps} />
      <span className={`size-9 flex items-center justify-center rounded-lg shrink-0 ${selected ? 'bg-primary text-white' : 'bg-slate-100 text-text-muted'}`}>
        <Icon size={18} />
      </span>
      <div>
        <p className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-text-primary'}`}>{title}</p>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{description}</p>
      </div>
    </label>
  )
}
```

- [ ] **Step 7: Build check**

Run: `npx next build`
Expected: compiles with no errors, no unused-variable/import warnings for `Wifi`, `Monitor`, `Camera`, `examMode`, or `ModeCard`.

- [ ] **Step 8: Manual check**

Run: `npm run dev`, log in as a lecturer, and confirm:
- Creating a new exam shows a "Delivery" section with just the access-code guidance — no mode selector, no proctoring toggle.
- The exam saves successfully and its detail page still shows an access-code panel afterward (unaffected by this change).

- [ ] **Step 9: Commit**

```bash
git add lib/validations/exams.js components/exams/ExamSettingsForm.js
git commit -m "feat: hide remote exam delivery mode and proctoring toggle from exam settings"
```
