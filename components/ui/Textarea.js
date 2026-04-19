/**
 * Textarea — plain text, multi-line input.
 * Used for tags, model answers, and other non-rich-text fields.
 */
export function Textarea({
  label,
  id,
  name,
  error,
  hint,
  required = false,
  rows = 3,
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
      <textarea
        id={id}
        name={name}
        rows={rows}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error}
        className={[
          'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text-primary bg-surface',
          'placeholder:text-text-muted resize-y',
          'transition-colors outline-none',
          error
            ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
            : 'border-border focus:border-border-focus focus:ring-2 focus:ring-primary/15',
          className,
        ].join(' ')}
        {...props}
      />
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
