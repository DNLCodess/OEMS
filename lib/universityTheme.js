function hexToRgb(hex) {
  const clean = hex.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }) {
  const toHex = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function mixToward(rgb, target, amount) {
  return {
    r: rgb.r + (target.r - rgb.r) * amount,
    g: rgb.g + (target.g - rgb.g) * amount,
    b: rgb.b + (target.b - rgb.b) * amount,
  }
}

const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 0, g: 0, b: 0 }

// Derives a light tint and a darker hover shade from one base color, so a
// university only ever has to pick one hex value — not three coordinated
// shades. Validated against PCU's own hand-picked values: mixing 25% toward
// black from #3A0A5E lands within a couple of RGB units of PCU's actual
// --color-primary-hover (#2C0747), so this formula reproduces a real,
// already-in-use design decision rather than an arbitrary guess.
export function deriveThemeColors(primaryHex) {
  const rgb = hexToRgb(primaryHex)
  return {
    primary:      rgbToHex(rgb),
    primaryLight: rgbToHex(mixToward(rgb, WHITE, 0.9)),
    primaryHover: rgbToHex(mixToward(rgb, BLACK, 0.25)),
  }
}

// Buttons and badges using this color always pair it with white text
// (--color-text-on-primary). A color too pale makes that text unreadable —
// this is checked at the point a color is *set*, not discovered later on a
// live login page. Standard YIQ perceived-brightness formula; 170/255 is a
// practical "should still read as a dark background" cutoff.
export function isDarkEnoughForWhiteText(hex) {
  const { r, g, b } = hexToRgb(hex)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness <= 170
}

// Returns a React style object overriding the three CSS custom properties,
// or undefined when the university has no custom color — callers spread
// this directly onto a wrapping element's `style` prop. style={undefined}
// is a React no-op, so a university with no color renders identically to
// today with zero special-casing at call sites.
export function getUniversityThemeStyle(university) {
  if (!university?.primary_color) return undefined
  const { primary, primaryLight, primaryHover } = deriveThemeColors(university.primary_color)
  return {
    '--color-primary':       primary,
    '--color-primary-light': primaryLight,
    '--color-primary-hover': primaryHover,
  }
}
