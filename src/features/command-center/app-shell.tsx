import Link from "next/link";
import type { ReactNode } from "react";
import "./command-center.css";

/**
 * Phase B navigation shell: account layer (Approvals primary; Activity and
 * Account & usage as utilities) around the channel layer in loop order.
 * Destinations this slice does not build are listed so the structure is
 * reviewable, but they are plain text, never dead links.
 */

const CHANNEL_DESTINATIONS = ["Strategy", "Content plan", "Videos", "Learning"];

export function AppShell({ channelLabel, channelDetail, pendingCount, banner, children }: {
  channelLabel: string;
  channelDetail: string;
  /** Pending gates across all channels; null when unknown. */
  pendingCount: number | null;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cw-app">
      <nav className="cw-side" aria-label="Studio">
        <p className="cw-word"><b>CHANNELWRIGHT</b><span className="cw-mono">Studio</span></p>
        <div className="cw-switch">
          <span className="cw-mono">Channel</span>
          <strong>{channelLabel}</strong>
          <span className="cw-mono">{channelDetail}</span>
        </div>
        <ul className="cw-nav" aria-label="This channel">
          <li><Link href="/studio/preview" aria-current="page">Command Center</Link></li>
          {CHANNEL_DESTINATIONS.map((label) => <li key={label}><span className="cw-nav-later">{label}<span className="cw-mono">Later</span></span></li>)}
        </ul>
        <ul className="cw-nav cw-nav-global" aria-label="Across channels">
          <li><span className="cw-nav-later">Approvals{pendingCount === null
            ? <span className="cw-badge cw-badge-unknown">—<span className="cw-sr"> pending count unavailable</span></span>
            : <span className="cw-badge">{pendingCount}<span className="cw-sr"> pending</span></span>}</span></li>
        </ul>
        <ul className="cw-nav cw-nav-foot" aria-label="Utilities">
          <li><span className="cw-nav-later">Activity</span></li>
          <li><span className="cw-nav-later">Account &amp; usage</span></li>
          <li><Link href="/studio">Open current Studio</Link></li>
        </ul>
      </nav>
      <main id="main" className="cw-main">
        {banner}
        {children}
      </main>
    </div>
  );
}
