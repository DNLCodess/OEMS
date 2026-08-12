import { describe, it, expect } from 'vitest'
import { deriveThemeColors, isDarkEnoughForWhiteText, getUniversityThemeStyle } from './universityTheme'

describe('deriveThemeColors', () => {
  it('returns the input color, uppercased, as primary', () => {
    const result = deriveThemeColors('#3a0a5e')
    expect(result.primary).toBe('#3A0A5E')
  })

  it('derives a hover shade close to PCU\'s own hand-picked value, validating the formula against a real design decision', () => {
    // PCU's actual --color-primary-hover (#2C0747) was hand-picked, not
    // formula-derived — this checks the 25%-toward-black formula lands
    // within a few RGB units of it, not an exact match.
    const result = deriveThemeColors('#3A0A5E')
    expect(result.primaryHover).toBe('#2C0847')
  })

  it('derives a light tint mixed toward white', () => {
    const result = deriveThemeColors('#3A0A5E')
    expect(result.primaryLight).toBe('#EBE7EF')
  })

  it('derives all three shades from black', () => {
    const result = deriveThemeColors('#000000')
    expect(result).toEqual({
      primary:      '#000000',
      primaryLight: '#E6E6E6',
      primaryHover: '#000000',
    })
  })
})

describe('isDarkEnoughForWhiteText', () => {
  it('accepts a dark color', () => {
    expect(isDarkEnoughForWhiteText('#3A0A5E')).toBe(true)
  })

  it('rejects a pale color white text would be unreadable on', () => {
    expect(isDarkEnoughForWhiteText('#F5F5F5')).toBe(false)
  })

  it('accepts pure black and rejects pure white, the two extremes', () => {
    expect(isDarkEnoughForWhiteText('#000000')).toBe(true)
    expect(isDarkEnoughForWhiteText('#FFFFFF')).toBe(false)
  })
})

describe('getUniversityThemeStyle', () => {
  it('returns undefined when the university has no primary_color set', () => {
    expect(getUniversityThemeStyle({ primary_color: null })).toBeUndefined()
  })

  it('returns undefined for null/undefined university (no lookup found)', () => {
    expect(getUniversityThemeStyle(null)).toBeUndefined()
    expect(getUniversityThemeStyle(undefined)).toBeUndefined()
  })

  it('returns the three CSS custom properties when a color is set', () => {
    const style = getUniversityThemeStyle({ primary_color: '#3A0A5E' })
    expect(style).toEqual({
      '--color-primary':       '#3A0A5E',
      '--color-primary-light': '#EBE7EF',
      '--color-primary-hover': '#2C0847',
    })
  })
})
