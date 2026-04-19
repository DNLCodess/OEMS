/**
 * TopBar — provides page-level context: title, breadcrumb, and a slot for actions.
 * Kept as a Server Component since it receives props from server layouts.
 */
export function TopBar({ title, subtitle, actions }) {
  return (
    <header className="sticky top-0 z-10 bg-surface border-b border-border px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-3 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  )
}
