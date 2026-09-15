const DIRECT_IP_HEADER = 'x-pcu-direct-ip'

export function resolveClientIp(headers) {
  const trustProxy = process.env.TRUST_PROXY === '1'
  if (trustProxy) {
    const xff = headers.get('x-forwarded-for')
    if (!xff) return null
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean)
    return hops.length ? hops[hops.length - 1] : null
  }
  return headers.get(DIRECT_IP_HEADER) || null
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

function ipv4ToInt(ip) {
  if (!IPV4_RE.test(ip)) return null
  const parts = ip.split('.').map(Number)
  if (parts.some((p) => p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

export function isIpAllowed(ip, entries) {
  if (!ip) return false
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return false

  for (const { entry } of entries) {
    if (!entry) continue
    if (entry.includes('/')) {
      const [base, bitsStr] = entry.split('/')
      const bits = Number(bitsStr)
      const baseInt = ipv4ToInt(base)
      if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      if ((ipInt & mask) === (baseInt & mask)) return true
    } else {
      const entryInt = ipv4ToInt(entry)
      if (entryInt !== null && entryInt === ipInt) return true
    }
  }
  return false
}

export function isValidEntry(entry) {
  if (!entry) return false
  const [ip, bits] = entry.split('/')
  if (ipv4ToInt(ip) === null) return false
  if (bits === undefined) return true
  const n = Number(bits)
  return Number.isInteger(n) && n >= 0 && n <= 32
}
