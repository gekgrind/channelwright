"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ColdOpen, IntelligenceRoom, IntelligenceCapabilities } from "./acts";
import { useReducedMotion } from "./scene";
import { refreshScenes } from "./scroll-engine";
import { CAPABILITIES, DEPARTMENTS, STATUS_LABEL, type CapabilityStatus } from "./capabilities";
import { FOOTER, INTELLIGENCE, NEXT_UP, OPEN, REGISTER } from "./copy";
import "./studios.css";

const BUILT_DEPARTMENTS = new Set(["intelligence"]);

/* ------------------------------------------------------------------ chrome */

function Topbar() {
  return (
    <header className="cw-topbar">
      <Link className="cw-topbar__mark" href="/studios-preview">
        <b>Channelwright</b>
        <span>Studios</span>
      </Link>
      <div className="cw-topbar__right">
        <a className="cw-cta cw-cta--ghost" href="#register">
          Capability register
        </a>
        <Link className="cw-cta" href="/login">
          Enter the studio
        </Link>
      </div>
    </header>
  );
}

/**
 * Which scene currently holds the stage. One observer serves both the rail and
 * the top bar, so chrome can recede during the cold open without a second pass.
 */
function useStageScene() {
  const [current, setCurrent] = useState<string | null>("open");

  useEffect(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>("[data-cw-scene]"));
    if (scenes.length === 0) return;

    // Track every scene's state, not just the one that changed, so the rail
    // disappears once the visitor has travelled past the last department.
    const intersecting = new Map<string, boolean>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) intersecting.set(entry.target.id, entry.isIntersecting);
        const active = scenes.find((scene) => intersecting.get(scene.id));
        setCurrent(active ? active.id : null);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );

    for (const scene of scenes) observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  return current;
}

function DepartmentRail({ current }: { current: string | null }) {
  return (
    <nav className="cw-rail" data-visible={current !== null && current !== "open"} aria-label="Studio departments">
      {DEPARTMENTS.map((department) => {
        const built = BUILT_DEPARTMENTS.has(department.id);
        return (
          <button
            key={department.id}
            type="button"
            className="cw-rail__item"
            data-current={current === department.id ? "true" : undefined}
            disabled={!built}
            aria-disabled={!built}
            title={built ? department.name : `${department.name} — in construction`}
            onClick={() => document.getElementById(department.id)?.scrollIntoView({ behavior: "smooth" })}
          >
            <span className="cw-rail__name">{department.name}</span>
            <span className="cw-rail__tick" aria-hidden="true" />
            <span>{department.index}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------ flow sections */

function CapabilityRegister() {
  const grouped = DEPARTMENTS.map((department) => ({
    department,
    entries: CAPABILITIES.filter((capability) => capability.department === department.index),
  })).filter((group) => group.entries.length > 0);

  return (
    <section id="register" className="cw-block cw-block--deep">
      <div className="cw-shell">
        <div className="cw-block__head">
          <p className="cw-mono cw-mono--signal">{REGISTER.kicker}</p>
          <h2 className="cw-heading">{REGISTER.heading}</h2>
          <p className="cw-lede">{REGISTER.body}</p>
          <div className="cw-tally">
            {REGISTER.legend.map((item) => (
              <span key={item.status} className="cw-status" data-status={item.status} title={item.note}>
                {STATUS_LABEL[item.status as CapabilityStatus]}
              </span>
            ))}
          </div>
        </div>

        <div className="cw-register">
          {grouped.map(({ department, entries }) => (
            <div key={department.id} className="cw-register__row">
              <span className="cw-register__dept">{department.index}</span>
              <div>
                {entries.map((capability) => (
                  <div key={capability.id} className="cw-capability">
                    <div className="cw-capability__head">
                      <span className="cw-capability__name">{capability.name}</span>
                      <span className="cw-status" data-status={capability.status}>
                        {STATUS_LABEL[capability.status]}
                      </span>
                    </div>
                    <p className="cw-capability__claim">{capability.claim}</p>
                    {capability.boundary ? (
                      <p className="cw-capability__boundary">{capability.boundary}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NextUp() {
  return (
    <section className="cw-block">
      <div className="cw-shell">
        <div className="cw-block__head">
          <p className="cw-mono">{NEXT_UP.kicker}</p>
          <h2 className="cw-heading">{NEXT_UP.heading}</h2>
          <p className="cw-lede">{NEXT_UP.body}</p>
        </div>
        <div className="cw-register">
          {DEPARTMENTS.map((department) => (
            <div key={department.id} className="cw-register__row">
              <span className="cw-register__dept">{department.index}</span>
              <div className="cw-capability">
                <div className="cw-capability__head">
                  <span className="cw-capability__name">{department.name}</span>
                  <span className="cw-status" data-status={BUILT_DEPARTMENTS.has(department.id) ? "OPERATING" : "DESIGNED"}>
                    {BUILT_DEPARTMENTS.has(department.id) ? "Built" : "In construction"}
                  </span>
                </div>
                <p className="cw-capability__claim">{department.line}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="cw-footer">
      <div className="cw-shell cw-footer__grid">
        <div>
          <p className="cw-mono cw-mono--signal">Channelwright Studios</p>
          <p className="cw-heading" style={{ marginTop: 14 }}>{FOOTER.line}</p>
        </div>
        <div style={{ display: "grid", gap: 18, justifyItems: "flex-start" }}>
          <Link className="cw-cta cw-cta--solid" href="/login">
            {OPEN.primaryCta}
          </Link>
          <p className="cw-footer__note">{FOOTER.note}</p>
        </div>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------- static mode */

function StaticNarrative() {
  return (
    <div className="cw-shell">
      <section className="cw-static__act">
        <div className="cw-static__whispers">
          {OPEN.slate.map((line) => (
            <p key={line} className="cw-mono">{line}</p>
          ))}
        </div>
        <p className="cw-mono cw-mono--signal">{OPEN.overline}</p>
        <h1 className="cw-display" style={{ marginTop: 18 }}>
          {OPEN.title.map((line) => (
            <span key={line} style={{ display: "block" }}>{line} </span>
          ))}
        </h1>
        <div className="cw-static__body">
          <p className="cw-lede">{OPEN.lede}</p>
          <div className="cw-open__actions" style={{ marginTop: 0 }}>
            <Link className="cw-cta cw-cta--solid" href="/login">{OPEN.primaryCta}</Link>
            <a className="cw-cta cw-cta--ghost" href="#register">{OPEN.secondaryCta}</a>
          </div>
        </div>
      </section>

      <section id="intelligence" className="cw-static__act">
        <p className="cw-mono">Department {INTELLIGENCE.index} — {INTELLIGENCE.department}</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{INTELLIGENCE.heading}</h2>
        <div className="cw-static__body">
          {INTELLIGENCE.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">{INTELLIGENCE.streamTitle}</span>
            <span className="cw-mono">{INTELLIGENCE.streamNote}</span>
          </div>
          <ol className="cw-stream">
            {INTELLIGENCE.steps.map((step) => (
              <li key={step.key} className="cw-stream__step" data-role={"role" in step ? step.role : undefined}>
                <span className="cw-stream__pip" aria-hidden="true" />
                <span>{step.label}</span>
                <span className="cw-stream__tag">{step.tag}</span>
              </li>
            ))}
          </ol>
          <div className="cw-ledger">
            {INTELLIGENCE.ledger.map((cell) => (
              <div key={cell.value} className="cw-ledger__cell" data-tone={cell.tone}>
                <span className="cw-ledger__value">{cell.value}</span>
                <span className="cw-mono cw-ledger__note">{cell.note}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 34 }}>
          <IntelligenceCapabilities />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export default function StudiosExperience() {
  const reduced = useReducedMotion();
  const stageScene = useStageScene();
  const root = useRef<HTMLDivElement>(null);

  // `data-ready` is written straight to the DOM rather than held in state: it
  // exists so scroll-driven styling stays inert until the engine is confirmed
  // to be driving, which keeps the page fully legible without JavaScript.
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    node.dataset.ready = reduced ? "false" : "true";
    if (reduced) return;
    // Web fonts settling changes scene heights; re-measure once they land.
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.ready.then(refreshScenes).catch(() => undefined);
  }, [reduced]);

  return (
    <div className="cw-studios" ref={root} data-ready="false" data-phase={reduced ? "static" : stageScene ?? undefined}>
      <Topbar />
      {reduced ? null : <DepartmentRail current={stageScene} />}

      <main id="main">
        {reduced ? (
          <StaticNarrative />
        ) : (
          <>
            <ColdOpen />
            <IntelligenceRoom />
          </>
        )}
        <CapabilityRegister />
        <NextUp />
      </main>

      <Footer />
      <span className="cw-preview-flag">Preview · /studios-preview</span>
    </div>
  );
}
