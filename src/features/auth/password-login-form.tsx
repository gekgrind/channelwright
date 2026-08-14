"use client";

import { useCallback, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CaptchaWidget, type CaptchaProvider } from "./captcha-widget";

export function PasswordLoginForm({ provider, siteKey }: { provider: CaptchaProvider | null; siteKey?: string }) {
  const [captchaToken, setCaptchaToken] = useState("");
  const handleTokenChange = useCallback((token: string) => setCaptchaToken(token), []);
  const configured = Boolean(provider && siteKey);

  return (
    <form action="/api/auth/login" method="post" className="stack-form">
      <label>Email<input name="email" type="email" autoComplete="email" required placeholder="operator@example.com" /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={6} placeholder="••••••••" /></label>
      {provider && siteKey
        ? <CaptchaWidget provider={provider} siteKey={siteKey} onTokenChange={handleTokenChange} />
        : <div className="error-banner" role="alert">The security check is not configured. Contact the Channelwright operator.</div>}
      <button className="button button-accent button-wide" type="submit" disabled={!configured || !captchaToken}>Enter studio <ArrowRight size={17} /></button>
    </form>
  );
}

