# OEMS — Online Examination Management System

A full-stack, multi-tenant Computer-Based Test (CBT) platform purpose-built for Nigerian universities. OEMS handles the complete exam lifecycle — from question authoring through to result publication — with role-scoped access for every stakeholder in the university exam process.

> **Academic Research Project** · Next.js 16 · Supabase · Tailwind CSS v4

---

## Features

### For Lecturers
- **Question Bank** — Author questions in 6 types: MCQ, multi-select, true/false, fill-in-the-blank, short answer, and essay. Full WYSIWYG editor with **LaTeX/KaTeX math rendering** for equations and scientific notation
- **Exam Builder** — Compose exams from the question bank, set marks per question, drag-and-drop reordering, per-student question and option randomisation
- **Delivery Modes** — *Remote*: students sit from anywhere with optional webcam proctoring (random-interval snapshots stored in private Supabase Storage). *Lab*: kiosk mode via a 6-character code shown on a projector — students see only the exam interface, no navigation
- **Tools & Aids** — Per-exam toggles for a floating scientific calculator and lecturer-authored tips students can open at any time during the exam
- **Exam Lifecycle** — `draft → scheduled → live → closed` state machine with manual or time-based activation
- **Results Analytics** — Score distribution histograms, pass rate bars, hardest-question analysis, at-risk student identification, one-click result release

### For Students
- **Exam Interface** — Full-screen anti-malpractice environment: tab-switch detection, fullscreen enforcement with 3-strike auto-submit, auto-save on every answer change, auto-submit on timer expiry
- **Smart Timer** — Urgency states: neutral → amber (under 10 min) → red pulse (under 3 min)
- **Question Navigation Panel** — Spatial grid showing answered / unanswered / flagged-for-review state at a glance
- **Performance Dashboard** — Pass rate, average score, trend analysis (improving / declining / steady), per-course breakdown with weak-course identification

### For Exam Officers
- User management across all faculties and departments
- Academic structure configuration (faculties, departments, courses)
- University-wide exam pipeline and result health monitoring

### For Platform Admins
- Multi-university onboarding and monitoring
- Platform-wide health stats and live exam tracking

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router · React 19 · JSX only — no TypeScript) |
| Database & Auth | Supabase (PostgreSQL · Auth · Storage · Row-Level Security) |
| Styling | Tailwind CSS v4 |
| Forms | React Hook Form + Zod |
| Rich Text | TipTap + `@tiptap/extension-mathematics` |
| Math Rendering | KaTeX |
| Icons | Lucide React |
| Notifications | Sonner |
| Dates | date-fns |

---

## Project Structure

```
oems/
├── app/
│   ├── (auth)/                    # Login, forgot-password (public, no layout chrome)
│   ├── student/                   # Student workspace + layout
│   │   ├── dashboard/             # Performance analytics, live exam alerts
│   │   ├── exams/[id]/            # Exam lobby → attempt interface
│   │   └── results/               # Course-grouped result history
│   ├── lecturer/                  # Lecturer workspace + layout
│   │   ├── dashboard/             # Exam pipeline, class health metrics
│   │   ├── questions/             # Question bank CRUD + WYSIWYG editor
│   │   ├── exams/[id]/            # Exam builder, workflow controls, lab code
│   │   └── results/               # Per-exam analytics, result release
│   ├── admin/                     # School Admin (Exam Officer) + layout
│   │   ├── users/                 # User management
│   │   ├── structure/             # Faculty + department management
│   │   └── courses/               # Course catalogue
│   ├── super-admin/               # Platform-level administration
│   ├── lab/                       # Kiosk mode (no sidebar, no navbar)
│   │   ├── page.js                # Lab code entry screen
│   │   └── [code]/attempt/        # Full-screen exam interface
│   └── dev/                       # Seed route (development only)
│
├── components/
│   ├── ui/                        # Primitives: Button, Input, Badge, MathContent…
│   ├── shared/                    # Sidebar, TopBar
│   ├── exams/                     # ExamBuilder, ExamSettingsForm, WorkflowPanel, LabCodePanel
│   ├── questions/                 # RichTextEditor, QuestionCard
│   └── student/                   # ExamInterface, ExamTimer, QuestionNav,
│                                  #   Calculator, TipsPanel, ProctoringCamera
│
├── lib/
│   ├── actions/                   # Server Actions (auth, exams, questions, attempts, results)
│   ├── supabase/                  # SSR-safe client helpers (server, client, middleware)
│   ├── validations/               # Zod schemas matching DB shape
│   └── dal.js                     # requireRole() — auth + role guard for Server Components
│
└── supabase/
    ├── schema.sql                 # Full baseline schema (run once on a fresh project)
    └── migrations/                # Incremental SQL migrations (timestamped, idempotent)
```

### Key Architectural Decisions

- **Server Components by default** — `"use client"` only where browser APIs or stateful interactivity are genuinely required
- **Server Actions over API routes** — all mutations go through `lib/actions/*.js`, each independently validates auth + role before touching the DB
- **Row-Level Security everywhere** — data access scoped by `university_id` derived from the server session, never from client input
- **SECURITY DEFINER helpers** — `auth_university_id()`, `auth_role()`, `exam_creator_id()` break circular RLS dependencies and are the single source of truth for session-derived identity

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone and install

```bash
git clone https://github.com/your-username/oems.git
cd oems
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

Find both values in your Supabase project under **Settings → API**.

### 3. Set up the database

Open the **SQL Editor** in your Supabase dashboard and run each file in order:

| Order | File | Purpose |
|---|---|---|
| 1 | `supabase/schema.sql` | Full baseline schema, RLS policies, helper functions |
| 2 | `migrations/20260418000000_student_question_bank_access.sql` | Student read access to question bank |
| 3 | `migrations/20260418120000_rls_hardening.sql` | RLS policy hardening |
| 4 | `migrations/20260419000000_lecturer_attempt_update.sql` | Lecturer permissions on attempts |
| 5 | `migrations/20260419120001_fix_matric_unique_constraint.sql` | Partial unique index for matric numbers |
| 6 | `migrations/20260419130000_fix_exam_rls_recursion.sql` | Fix circular RLS dependency |
| 7 | `migrations/20260419150000_exam_modes_calculator_tips.sql` | Exam modes, calculator, tips, proctoring |

> All migration files are idempotent — safe to re-run if needed.

### 4. Seed development data (optional)

With the app running, visit `/dev` to seed:
- A demo university (Delta University)
- One user per role (super admin, school admin, lecturer, student)
- Sample courses, a question bank, and a live exam ready to take

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Dev credentials** (after seeding):

| Role | Email | Password |
|---|---|---|
| Super Admin | `superadmin@oems.ng` | `Password123!` |
| School Admin | `admin@dun.edu.ng` | `Password123!` |
| Lecturer | `lecturer@dun.edu.ng` | `Password123!` |
| Student | `student@dun.edu.ng` | `Password123!` |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |

> The anon key is safe to expose publicly — all data access is enforced by Supabase RLS policies, not by key secrecy.

---

## Database Schema

```
universities
├── faculties
│   └── departments
│       └── courses

users (extends Supabase Auth)
  role ∈ { super_admin · school_admin · lecturer · student }

question_bank          6 types · JSONB options + correct_answer · per-university
exams                  status: draft → scheduled → live → closed
├── exam_questions     ordered, per-question marks
├── exam_access        per-student allowlist
└── attempts           one per student per exam
    └── responses      one per question; auto-graded for objective types

results                released_at gated — students see nothing until lecturer releases
proctoring_snapshots   webcam captures → private Supabase Storage bucket
```

---

## Security Highlights

- RLS enabled on every table; policies reference `auth_university_id()` and `auth_role()` SECURITY DEFINER functions
- Every Server Action independently calls `auth.getUser()` and verifies role + `university_id` before any write
- `university_id` is always derived from the authenticated server session — never trusted from client input
- Exam correct answers are **never included** in any client-side query
- Students cannot access another student's attempt, responses, or unreleased results
- Proctoring snapshots are stored in a private bucket and never exposed to students

---

## Roadmap

- [x] Multi-university SaaS with role-based access control
- [x] Question bank — 6 question types, WYSIWYG editor, LaTeX math
- [x] Exam builder with full `draft → live → closed` lifecycle
- [x] Student exam interface — timer, auto-save, anti-malpractice
- [x] Remote delivery with optional webcam proctoring
- [x] Lab kiosk mode (6-character code, stripped-down UI)
- [x] In-exam scientific calculator + lecturer tips panel
- [x] Lecturer results analytics (distribution, hardest questions, at-risk students)
- [x] Student performance dashboard (trends, weak courses)
- [ ] Manual grading UI for essay and short-answer questions
- [ ] CSV and PDF result export
- [ ] Nigerian CGPA computation
- [ ] Anti-malpractice v2 (copy-paste detection, window-focus tracking)
- [ ] Full mobile responsiveness

---

## Background

Built as an academic research project: *"Design and Development of a Computer-Based Test Platform for Nigerian Universities."*

The domain model reflects how Nigerian universities actually operate — matric numbers as the primary student identifier, the faculty → department → course hierarchy, CA / mid-semester / end-of-semester exam types, and the Nigerian 5-point CGPA scale.

---

## License

MIT
