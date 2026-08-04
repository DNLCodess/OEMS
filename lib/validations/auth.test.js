import { describe, it, expect } from 'vitest'
import { loginSchema, forgotPasswordSchema, resetPasswordSchema } from './auth'

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: 'secret1' })
    expect(result.success).toBe(true)
  })

  it('rejects a missing email', () => {
    const result = loginSchema.safeParse({ email: '', password: 'secret1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.email).toContain('Email is required')
  })

  it('rejects an invalid email format', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'secret1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.email).toContain('Enter a valid email address')
  })

  it('rejects a password shorter than 6 characters', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com', password: '123' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.password).toContain('Password must be at least 6 characters')
  })
})

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'user@example.com' }).success).toBe(true)
  })

  it('rejects an invalid email', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false)
  })
})

describe('resetPasswordSchema', () => {
  it('accepts matching passwords of at least 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'longenough' })
    expect(result.success).toBe(true)
  })

  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({ password: 'longenough', confirmPassword: 'different' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.confirmPassword).toContain('Passwords do not match')
  })

  it('rejects a password shorter than 8 characters', () => {
    const result = resetPasswordSchema.safeParse({ password: 'short1', confirmPassword: 'short1' })
    expect(result.success).toBe(false)
    expect(result.error.flatten().fieldErrors.password).toContain('Password must be at least 8 characters')
  })
})
