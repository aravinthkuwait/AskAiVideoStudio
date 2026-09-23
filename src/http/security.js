// Security headers applied to every response. Strict CSP: no inline scripts
// or styles, no third-party origins, no framing.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function applySecurityHeaders(res, { secure }) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

/** Same-origin check for state-changing requests (defence in depth next to the CSRF token). */
export function originAllowed(req, trustProxy = false) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; CSRF token still required
  try {
    const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
    return new URL(origin).host === host;
  } catch { return false; }
}
