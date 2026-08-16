import type { NextConfig } from "next";

const captchaScriptOrigins = "https://challenges.cloudflare.com https://js.hcaptcha.com https://newassets.hcaptcha.com";
const captchaFrameOrigins = "https://challenges.cloudflare.com https://newassets.hcaptcha.com";
const captchaConnectOrigins = "https://challenges.cloudflare.com https://api.hcaptcha.com";

export function contentSecurityPolicy(environment = process.env.NODE_ENV, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const supabaseOrigin = supabaseUrl ? safeOrigin(supabaseUrl) : null;
  const scriptSources = ["'self'", "'unsafe-inline'", environment === "production" ? null : "'unsafe-eval'", captchaScriptOrigins].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `frame-src ${captchaFrameOrigins}`,
    ["connect-src 'self'", supabaseOrigin, supabaseOrigin?.replace(/^https:/, "wss:"), captchaConnectOrigins].filter(Boolean).join(" "),
  ].join("; ");
}

function safeOrigin(value: string) {
  try { return new URL(value).origin; } catch { return null; }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@remotion/renderer"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
