import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth/constants'
import { SESSION_CHANNELS } from '@/lib/db/enums'
import {
  createSessionRow, findSessionWithUser, touchSession, deleteSession,
} from '@/lib/db/repositories/sessions'

const IDLE_MS = 12 * 60 * 60 * 1000 // 12h sliding
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000 // 7d hard cap
const TOUCH_THROTTLE_MS = 60 * 1000

const sha256 = (s) => createHash('sha256').update(s).digest('hex')
const cookieSecure = () => process.env.SESSION_COOKIE_SECURE === '1'

export async function createSession({ userId, channel, verifiedExamId = null, clientIp = null }) {
  if (!SESSION_CHANNELS.includes(channel)) throw new Error(`invalid session channel: ${channel}`)

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  await createSessionRow({
    id: sha256(token),
    user_id: userId,
    channel,
    verified_exam_id: verifiedExamId,
    client_ip: clientIp,
    created_at: now,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + IDLE_MS),
  })

  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: Math.floor(IDLE_MS / 1000),
  })
}

export async function readSessionUser() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null

  const id = sha256(token)
  const row = await findSessionWithUser(id)
  if (!row) return null

  const now = new Date()
  const absoluteDeadline = new Date(new Date(row.created_at).getTime() + ABSOLUTE_MS)
  if (row.expires_at < now || absoluteDeadline < now) {
    await deleteSession(id)
    return null
  }
  if (!row.user) return null

  if (now.getTime() - new Date(row.last_seen_at).getTime() > TOUCH_THROTTLE_MS) {
    await touchSession(id, now, new Date(now.getTime() + IDLE_MS))
  }
  return row.user
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await deleteSession(sha256(token))
  jar.delete(SESSION_COOKIE)
}
