import 'server-only'
import { prisma } from '@/lib/db/client'
import { ADMIN_LOG_ACTIONS } from '@/lib/db/enums'

// Audit logging must never break the operation it records. Any failure
// (bad action, DB hiccup) is swallowed after a console.error — matching the
// pre-migration behaviour in lib/actions/auth.js.
export async function recordAuthEvent(fields) {
  try {
    if (!ADMIN_LOG_ACTIONS.includes(fields.action)) {
      throw new Error(`unknown audit action: ${fields.action}`)
    }
    await prisma.adminActionLog.create({
      data: {
        action: fields.action,
        actor_id: fields.actor_id ?? null,
        university_id: fields.university_id ?? null,
        target_user_id: fields.target_user_id ?? null,
        target_identifier: fields.target_identifier ?? null,
        subject_role: fields.subject_role ?? null,
        meta: fields.meta ? JSON.stringify(fields.meta) : null,
      },
    })
  } catch (e) {
    console.error('[auditLog] recordAuthEvent failed', e.message)
  }
}
