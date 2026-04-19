# OEMS — Online Examination Management System

A full-stack, multi-tenant Computer-Based Test (CBT) platform built for Nigerian universities. Covers the complete exam lifecycle from question authoring to result publication, with role-scoped access for every stakeholder.

> Academic Research Project · Next.js 16 · Supabase · Tailwind CSS v4

---

## Tech Stack

- **Framework** — Next.js 16 (App Router, React 19)
- **Backend** — Supabase (PostgreSQL, Auth, Storage, RLS)
- **Styling** — Tailwind CSS v4
- **Forms** — React Hook Form + Zod
- **Editor** — TipTap with KaTeX math rendering
- **Icons** — Lucide React

---

## Roles

| Role | Access |
|---|---|
| Super Admin | Platform-level — university onboarding, system config |
| School Admin | University-level — users, structure, exam oversight |
| Lecturer | Course-level — question bank, exam management, results |
| Student | Exam taking, personal results and performance |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### Setup

```bash
git clone https://github.com/DNLCodess/OEMS.git
cd OEMS
npm install
cp .env.local.example .env.local
```

Fill in `.env.local` with your Supabase project URL and anon key (found under **Settings → API**):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## License

MIT
