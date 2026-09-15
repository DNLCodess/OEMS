import 'server-only'
import { prisma } from '@/lib/db/client'

export async function getInstitution() {
  return prisma.university.findFirst()
}

export async function updateInstitution({ name, logoUrl, primaryColor }) {
  const institution = await prisma.university.findFirst({ select: { id: true } })
  if (!institution) throw new Error('No institution row exists')
  return prisma.university.update({
    where: { id: institution.id },
    data: { name, logo_url: logoUrl || null, primary_color: primaryColor || null },
  })
}
