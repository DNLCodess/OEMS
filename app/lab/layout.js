// Kiosk layout — no sidebar, no navigation. Used for lab/supervised exam sessions.
export default function LabLayout({ children }) {
  return (
    <div className="min-h-screen bg-page flex flex-col">
      {children}
    </div>
  )
}
