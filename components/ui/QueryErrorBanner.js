export function QueryErrorBanner({ message }) {
  return (
    <div className="bg-danger-light border border-danger/20 rounded-xl px-5 py-4 text-sm text-danger">
      {message}
    </div>
  )
}
