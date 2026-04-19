/**
 * Input — intentionally unstyled on the outside, styled through the wrapper.
 * Always shows label above, error below. Never rely on placeholder as label —
 * placeholder disappears on typing, leaving users with no context.
 */
export function Input({
  label,
  id,
  name,
  type = 'text',
  error,
  hint,
  required = false,
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
      <input
        id={id}
        name={name}
        type={type}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-invalid={!!error}
        className={[
          'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text-primary bg-surface',
          'placeholder:text-text-muted',
          'transition-colors outline-none',
          error
            ? 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20'
            : 'border-border focus:border-border-focus focus:ring-2 focus:ring-primary/15',
          className,
        ].join(' ')}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
