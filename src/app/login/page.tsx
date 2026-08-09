import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react";
import { isMockMode } from "@/server/config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const mock = isMockMode();
  return (
    <main id="main" className="auth-shell">
      <section className="auth-manifesto">
        <Link className="wordmark" href="/"><span>CW</span> CHANNELWRIGHT</Link>
        <div><p className="eyebrow">Private production floor</p><h1>Ideas enter.<br /><em>Evidence leaves.</em></h1><p>Every recommendation remains advisory. Every override remains visible. Every script stops for a human.</p></div>
        <p className="auth-foot">STRUCTURED / SOURCE-AWARE / REVIEWABLE</p>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-form-card">
          <div className="icon-tile"><LockKeyhole size={22} /></div>
          <p className="eyebrow">Studio access</p><h2>Sign in to continue</h2>
          <p className="muted">{mock ? "Fixture mode is active. Any valid email and 6+ character password creates a local demo session." : "Use your Supabase account credentials."}</p>
          {error && <div className="error-banner" role="alert">{error === "invalid" ? "Enter a valid email and password." : "Authentication failed. Check your credentials."}</div>}
          <form action="/api/auth/login" method="post" className="stack-form">
            <label>Email<input name="email" type="email" autoComplete="email" required placeholder="operator@example.com" /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" required minLength={6} placeholder="••••••••" /></label>
            <button className="button button-accent button-wide" type="submit">Enter studio <ArrowRight size={17} /></button>
          </form>
          <Link className="back-link" href="/"><ArrowLeft size={14} /> Back to overview</Link>
        </div>
      </section>
    </main>
  );
}
