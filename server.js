// Minimal custom server. Next.js App Router gives Server Actions and Route
// Handlers no access to the raw TCP socket — only request headers. With no
// reverse proxy in front (the LAN deployment is plain HTTP straight from
// Node), there is otherwise no trustworthy source of the client's real IP:
// a client can set X-Forwarded-For itself via curl/fetch(). So this file
// is the one place that reads req.socket.remoteAddress directly, and it
// stamps it into a header the rest of the app trusts — after first
// deleting any client-supplied copy, so it can never be spoofed.
import { createServer } from 'node:http'
import next from 'next'

const DIRECT_IP_HEADER = 'x-pcu-direct-ip'
const dev = process.env.NODE_ENV === 'development'
const hostname = process.env.HOSTNAME || '0.0.0.0' // IPv4 only — matches the lab LAN target
const port = Number(process.env.PORT) || 3000

const app = next({ dev, hostname, port, turbopack: dev })
const handle = app.getRequestHandler()

function normalizeIp(addr) {
  if (!addr) return 'unknown'
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr
}

app.prepare().then(() => {
  // Must be requested only after prepare() resolves.
  const handleUpgrade = app.getUpgradeHandler()

  const server = createServer((req, res) => {
    delete req.headers[DIRECT_IP_HEADER]
    req.headers[DIRECT_IP_HEADER] = normalizeIp(req.socket.remoteAddress)
    handle(req, res)
  })

  // Dev-mode HMR (Turbopack/webpack) upgrades the connection to a
  // WebSocket. A plain http.createServer ignores 'upgrade' by default,
  // which silently breaks the HMR socket — and with it, client hydration
  // reliability. Next's custom-server API exists specifically for this.
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head)
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})
