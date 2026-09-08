import { hash, verify } from '@node-rs/argon2'

// OWASP argon2id minimum (spec NFR-SEC-6). Staff-login only, low volume.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }

export async function hashPassword(plain) {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(hashString, plain) {
  try {
    return await verify(hashString, plain, OPTIONS)
  } catch {
    // Malformed/foreign hash string — treat as a non-match, never crash a login.
    return false
  }
}
