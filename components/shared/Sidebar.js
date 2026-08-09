'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, BookOpen, ClipboardList,
  BarChart2, GraduationCap, Building2, Settings,
  FileQuestion, ScrollText, LogOut, Menu, X,
} from 'lucide-react'
import { signOut } from '@/lib/actions/auth'

const NAV = {
  super_admin: [
    { label: 'Dashboard', href: '/super-admin/dashboard', icon: LayoutDashboard },
    { label: 'All Users', href: '/super-admin/users',     icon: Users },
    { label: 'Settings',  href: '/super-admin/settings',  icon: Settings },
  ],
  school_admin: [
    { label: 'Dashboard',         href: '/admin/dashboard',  icon: LayoutDashboard },
    { label: 'Users',             href: '/admin/users',       icon: Users },
    { label: 'Faculties & Depts', href: '/admin/structure',   icon: Building2 },
    { label: 'Courses',           href: '/admin/courses',     icon: BookOpen },
    { label: 'Exam Oversight',    href: '/admin/exams',       icon: ClipboardList },
  ],
  lecturer: [
    { label: 'Dashboard',     href: '/lecturer/dashboard', icon: LayoutDashboard },
    { label: 'Question Bank', href: '/lecturer/questions', icon: FileQuestion },
    { label: 'Exams',         href: '/lecturer/exams',     icon: ScrollText },
    { label: 'Results',       href: '/lecturer/results',   icon: BarChart2 },
  ],
  student: [
    { label: 'Dashboard', href: '/student/dashboard', icon: LayoutDashboard },
    { label: 'My Exams',  href: '/student/exams',     icon: ClipboardList },
    { label: 'Results',   href: '/student/results',   icon: BarChart2 },
  ],
}

const ROLE_LABEL = {
  super_admin:  'Platform Admin',
  school_admin: 'Exam Officer',
  lecturer:     'Lecturer Portal',
  student:      'Student Portal',
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

export function Sidebar({ user }) {
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
              <GraduationCap className="size-5 text-white" />
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
            <GraduationCap className="size-4 text-white" />
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
              <GraduationCap className="size-5 text-white" />
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
