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

export async function listAllEntries(universityId) {
  return prisma.labIpAllowlist.findMany({
    where: { university_id: universityId },
    orderBy: { created_at: 'desc' },
  })
}

export async function setEntryActive(id, isActive) {
  return prisma.labIpAllowlist.update({ where: { id }, data: { is_active: isActive } })
}

const MAX_RANGE_HOSTS = 1024

function ipToInt(ip) {
  return ip.split('.').map(Number).reduce((acc, o) => (acc << 8) + o, 0) >>> 0
}
function intToIp(n) {
  return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join('.')
}

// Expands a start-end IPv4 range into individual per-host rows — the
// "add range" bulk helper FR-LAB-1 describes for the ~50-PC per-host
// approach. Skips any host already present for this university rather
// than erroring the whole batch on one collision.
export async function addRange({ universityId, startIp, endIp, label, createdBy }) {
  const startInt = ipToInt(startIp)
  const endInt = ipToInt(endIp)
  if (startInt > endInt) throw new Error('Range start must not be after range end')
  if (endInt - startInt + 1 > MAX_RANGE_HOSTS) throw new Error(`Range too large (max ${MAX_RANGE_HOSTS} hosts)`)

  const existing = await prisma.labIpAllowlist.findMany({
    where: { university_id: universityId },
    select: { entry: true },
  })
  const existingSet = new Set(existing.map((e) => e.entry))

  const created = []
  for (let n = startInt; n <= endInt; n++) {
    const ip = intToIp(n)
    if (existingSet.has(ip)) continue
    created.push(await prisma.labIpAllowlist.create({
      data: { university_id: universityId, entry: ip, label, created_by: createdBy },
    }))
  }
  return created
}
