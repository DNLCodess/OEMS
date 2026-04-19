'use client'

import { useFormStatus } from 'react-dom'

const variants = {
  primary:   'bg-primary text-white hover:bg-primary-hover focus-visible:ring-primary/50 disabled:bg-primary/50',
  secondary: 'bg-white text-primary border border-border hover:bg-page focus-visible:ring-primary/30',
  danger:    'bg-danger text-white hover:bg-red-700 focus-visible:ring-danger/50 disabled:bg-danger/50',
  ghost:     'bg-transparent text-text-secondary hover:bg-border/60 focus-visible:ring-border',
}

const sizes = {
  sm: 'h-8  px-3 text-sm  gap-1.5',
  md: 'h-10 px-4 text-sm  gap-2',
  lg: 'h-11 px-5 text-base gap-2',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center justify-center font-medium rounded-lg',
        'transition-colors focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      ].join(' ')}
      {...props}
    >
      {loading && (
        <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
      )}
      {children}
    </button>
  )
}

/**
 * Submit button that reads pending state from the nearest <form> automatically.
 * Use inside <form> elements — replaces Button for submit use cases.
 */
export function SubmitButton({ children, loadingText, variant = 'primary', size = 'md', className = '' }) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      loading={pending}
      disabled={pending}
      className={className}
    >
      {pending && loadingText ? loadingText : children}
    </Button>
  )
}
