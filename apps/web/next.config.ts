import type { NextConfig } from "next";

const securityHeaders = [
  // Clickjacking: the app never runs in a frame.
  { key: "X-Frame-Options", value: "DENY" },
  // MIME sniffing off for all responses.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Least-privilege referrer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone is used by voice-guided diagnostics (same origin only);
  // geolocation is used by the opt-in nearby-technician search (same
  // origin only; coordinates are query params, never stored); camera
  // stays disabled until a feature needs it.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
  // HTTPS-only upgrade (ignored over plain HTTP/localhost).
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // NOTE: no script-src Content-Security-Policy. Next.js dev/HMR and the
  // pre-paint theme script rely on inline bootstraps; a script CSP would
  // break local development. Revisit with nonces for a locked-down
  // production deployment.
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
