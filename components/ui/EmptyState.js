/**
 * EmptyState — every empty state must include an action.
 * A dead-end empty state forces the user to figure out the next step themselves.
 * Reason: guiding immediately reduces frustration and abandonment.
 */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {Icon && (
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary-light mb-4">
          <Icon className="size-7 text-primary" />
        </span>
      )}
      <h3 className="text-base font-semibold text-text-primary mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-text-secondary max-w-xs leading-relaxed mb-6">
          {description}
        </p>
      )}
      {action && <div>{action}</div>}
    </div>
  )
}
