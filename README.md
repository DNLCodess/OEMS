# PCU CBT — Precious Cornerstone University Computer-Based Testing Platform

A full-stack Computer-Based Test (CBT) platform built for Precious Cornerstone University (PCU), Ibadan. Covers the complete exam lifecycle from question authoring to result publication, with role-scoped access for every stakeholder.

> Academic Research Project · Precious Cornerstone University · Next.js 16 · Supabase · Tailwind CSS v4

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
git clone https://github.com/DNLCodess/pcu-cbt.git
cd pcu-cbt
npm install
cp .env.local.example .env.local
```

Fill in `.env.local` with your Supabase project URL and anon key (found under **Settings → API**):

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

> **Migration in progress:** the backend is moving from Supabase/Postgres to
> self-hosted **SQL Server** (see `docs/superpowers/specs/2026-09-07-sqlserver-migration-design.md`).

## Database (local dev)

SQL Server via Docker, managed with **Prisma**. Full guide:
[`docs/db/README.md`](docs/db/README.md). Quick start:

```bash
docker start pcucbt-sql
npm run db:migrate   # apply migrations + generate client
npm run db:seed      # baseline data (one institution + bootstrap admin)
```

Seed credentials: `superadmin@pcu.edu.ng` / value of `SEED_SUPER_ADMIN_PASSWORD`
(you're forced to set a new password on first login).

---

## License

MIT
