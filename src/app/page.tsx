import Link from "next/link";
import { ArrowRight, Check, GitBranch, ShieldCheck, Sparkles } from "lucide-react";

const rails = [
  ["01", "Choose a path", "Bring a concept or ask the studio to discover evidence-ranked directions."],
  ["02", "Test the premise", "Five explicit gates separate research evidence from recommendation judgment."],
  ["03", "Keep control", "Override, revise, or switch direction without rewriting the historical record."],
  ["04", "Produce deliberately", "Strategy, research, script, QA, and human approval move through strict states."],
];

export default function HomePage() {
  return (
    <main id="main" className="landing-shell">
      <nav className="topbar" aria-label="Primary">
        <Link className="wordmark" href="/"><span>CW</span> CHANNELWRIGHT</Link>
        <div className="topbar-meta"><span>STUDIO SYSTEM / 01</span><Link className="button button-small" href="/login">Enter studio <ArrowRight size={15} /></Link></div>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy reveal">
          <p className="eyebrow"><span className="live-dot" /> Deterministic content operations</p>
          <h1>Build channels<br />with a <em>thesis.</em></h1>
          <p className="hero-lede">Channelwright turns channel ideas into source-aware strategies and reviewable video scripts—without pretending an autonomous swarm is a production system.</p>
          <div className="hero-actions"><Link className="button button-accent" href="/login">Open the studio <ArrowRight size={17} /></Link><a className="text-link" href="#method">See the workflow ↓</a></div>
        </div>
        <aside className="signal-board reveal delay-1" aria-label="System signal board">
          <div className="signal-head"><span>CONCEPT / SIGNAL</span><Sparkles size={16} /></div>
          <div className="signal-score"><strong>86</strong><span>/100<br />VIABLE</span></div>
          <div className="meter-list">
            {[['CONTENT RUNWAY', 93], ['AUDIENCE DEMAND', 88], ['MONETIZATION', 84], ['DIFFERENTIATION', 78], ['PRODUCTION', 89]].map(([label, value]) => <div className="meter" key={label}><div><span>{label}</span><b>{value}</b></div><i style={{ width: `${value}%` }} /></div>)}
          </div>
          <p className="signal-note">Research suggests a defensible, repeatable format. Live evidence is required before budget commitment.</p>
        </aside>
      </section>

      <section className="proof-strip" aria-label="Product principles">
        <span><GitBranch size={16} /> EXPLICIT STATES</span><span><ShieldCheck size={16} /> HUMAN GATES</span><span><Check size={16} /> VALIDATED OUTPUTS</span><span><Check size={16} /> AUDITABLE COSTS</span>
      </section>

      <section className="method-section" id="method">
        <div className="section-intro"><p className="eyebrow">The operating method</p><h2>Creative work.<br /><em>Production discipline.</em></h2></div>
        <div className="process-rail">{rails.map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div>
      </section>
      <footer className="landing-footer"><span>CHANNELWRIGHT © 2026</span><span>PART OF THE ENTREPRENEURIA ECOSYSTEM</span></footer>
    </main>
  );
}
