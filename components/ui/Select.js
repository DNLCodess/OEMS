/**
 * Select — native <select> with consistent design-system styling.
 * Uses native select for accessibility and keyboard navigation — no custom dropdown.
 * Reason: custom dropdowns frequently break keyboard nav and screen readers.
 */
export function Select({
  label,
  id,
  name,
  error,
  hint,
  required = false,
  children,
  className = '',
  ...props
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text-primary">
          {label}
          {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        id={id}
        name={name}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
        className={[
          'w-full rounded-lg border px-3.5 py-2.5 text-sm bg-surface',
          'text-text-primary appearance-none cursor-pointer',
          'transition-colors outline-none',
          error
            ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
            : 'border-border focus:border-border-focus focus:ring-2 focus:ring-primary/15',
          className,
        ].join(' ')}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.5'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 0.875rem center',
          paddingRight: '2.5rem',
        }}
        {...props}
      >
        {children}
      </select>
      {hint && !error && (
        <p className="text-xs text-text-muted">{hint}</p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
