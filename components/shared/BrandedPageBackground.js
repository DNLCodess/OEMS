// Fixed, full-viewport background image with a translucent page-color wash
// on top. The wash is what keeps every existing text color exactly as
// readable as it was against the plain --color-page background — no text
// color needs to change anywhere, the overlay does all the contrast work,
// regardless of how bright or busy the photo underneath is. Both layers
// use a negative z-index and `fixed` positioning, so they paint behind
// normal page content without affecting any page's own layout/flow.
export function BrandedPageBackground({ children }) {
  return (
    <>
      <div
        className="fixed inset-0 -z-20 bg-cover bg-center"
        style={{ backgroundImage: "url('/pcu/pcu-image1.jpeg')" }}
        aria-hidden="true"
      />
      <div className="fixed inset-0 -z-10 bg-page/85" aria-hidden="true" />
      {children}
    </>
  )
}
