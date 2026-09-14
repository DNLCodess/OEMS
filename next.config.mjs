/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Dev-only: Next.js blocks cross-origin requests to dev assets (HMR, RSC
  // payloads) by default, which silently breaks client hydration for any
  // origin not on this list. This app's whole point is being reached by IP
  // on a LAN (127.0.0.1 locally, 192.168.x.x from lab PCs), not just
  // "localhost", so those need to be explicitly allowed for `npm run dev`
  // to actually work when opened that way. Has no effect in production.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.0.0/16'],
};

export default nextConfig;
