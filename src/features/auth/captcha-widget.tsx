"use client";

import { useEffect, useId, useRef, useState } from "react";

export type CaptchaProvider = "turnstile" | "hcaptcha";
type CaptchaStatus = "loading" | "ready" | "verified" | "expired" | "failed" | "unavailable";

type WidgetApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove?(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: WidgetApi;
    hcaptcha?: WidgetApi;
  }
}

const providerConfig = {
  turnstile: { source: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", label: "Cloudflare Turnstile" },
  hcaptcha: { source: "https://js.hcaptcha.com/1/api.js?render=explicit", label: "hCaptcha" },
} as const;

export function CaptchaWidget({ provider, siteKey, onTokenChange }: { provider: CaptchaProvider; siteKey: string; onTokenChange?: (token: string) => void }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<CaptchaStatus>("loading");
  const config = providerConfig[provider];

  useEffect(() => {
    let disposed = false;
    const scriptId = `channelwright-${provider}-script`;

    const render = () => {
      if (disposed || !containerRef.current) return;
      const api = window[provider];
      if (!api) return;
      try {
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (value: string) => { setToken(value); onTokenChange?.(value); setStatus("verified"); },
          "expired-callback": () => { setToken(""); onTokenChange?.(""); setStatus("expired"); },
          "error-callback": () => { setToken(""); onTokenChange?.(""); setStatus("failed"); },
          theme: "light",
          size: "normal",
        });
        setStatus("ready");
      } catch {
        setStatus("unavailable");
      }
    };

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (window[provider]) render();
    else if (existing) existing.addEventListener("load", render, { once: true });
    else {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = config.source;
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => setStatus("unavailable"), { once: true });
      document.head.appendChild(script);
    }
    const timeout = setTimeout(() => { if (!window[provider]) setStatus("unavailable"); }, 15_000);

    return () => {
      disposed = true;
      clearTimeout(timeout);
      if (existing) existing.removeEventListener("load", render);
      if (widgetIdRef.current) window[provider]?.remove?.(widgetIdRef.current);
    };
  }, [config.source, onTokenChange, provider, siteKey]);

  const retry = () => {
    setToken("");
    onTokenChange?.("");
    try {
      window[provider]?.reset(widgetIdRef.current);
      setStatus("ready");
    } catch {
      setStatus("unavailable");
    }
  };

  const message = status === "loading" ? `Loading ${config.label}…`
    : status === "verified" ? "Security check complete."
      : status === "expired" ? "The security check expired. Complete it again."
        : status === "failed" ? "The security check failed. Try again."
          : status === "unavailable" ? "The security check could not load. Check your connection or content blocker, then retry."
            : "Complete the security check to enable sign in.";

  return (
    <div className="captcha-field" data-status={status}>
      <div id={`captcha-${reactId.replaceAll(":", "")}`} ref={containerRef} aria-label={`${config.label} security challenge`} />
      <input type="hidden" name="captchaToken" value={token} />
      <p aria-live="polite">{message}</p>
      {(["expired", "failed", "unavailable"] as CaptchaStatus[]).includes(status)
        ? <button className="captcha-retry" type="button" onClick={retry}>Retry security check</button>
        : null}
    </div>
  );
}
