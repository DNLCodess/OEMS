// Kiosk layout — no sidebar, no navigation. Used for unauthenticated result lookup.
export default function CheckResultLayout({ children }) {
  return (
    <div className="min-h-screen bg-page flex flex-col">
      {children}
    </div>
  )
}
