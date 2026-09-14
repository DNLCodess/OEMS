import 'server-only'
import { prisma } from '@/lib/db/client'

export async function listActiveEntries(universityId) {
  return prisma.labIpAllowlist.findMany({
    where: { university_id: universityId, is_active: true },
    select: { id: true, entry: true, label: true },
  })
}

export async function createEntry({ universityId, entry, label, createdBy }) {
  return prisma.labIpAllowlist.create({
    data: { university_id: universityId, entry, label, created_by: createdBy },
  })
}
