"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ColdOpen, IntelligenceRoom, IntelligenceCapabilities, StrategyRoom, WritersRoom, ProductionFloor, ControlRoom, TheReturn, NextDecision } from "./acts";
import { StudiosWorld } from "./world";
import { HallFar, HallNear } from "./facility";
import { useReducedMotion } from "./scene";
import { refreshScenes } from "./scroll-engine";
import { useSmoothScroll } from "./smooth-scroll";
import { CAPABILITIES, DEPARTMENTS, STATUS_LABEL, type CapabilityStatus } from "./capabilities";
import { ARTIFACT, CONTROL, FINALE, FOOTER, INTELLIGENCE, OPEN, PRODUCTION, REGISTER, RETURN, STRATEGY, WORLD, WRITERS } from "./copy";
import "./studios.css";


/** Wrapper whose scroll span drives the persistent facility. */
const JOURNEY_ID = "cw-journey";

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
        // Scenes overlap by a viewport, so more than one can be intersecting at
        // a handoff. The later one is the room being entered, so it wins.
        const active = [...scenes].reverse().find((scene) => intersecting.get(scene.id));
        setCurrent(active ? active.id : null);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );

    for (const scene of scenes) observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  return current;
}

/* ------------------------------------------------------------ flow sections */

/** The same hall, pinned behind the register/next-up/footer flow. The
 *  cinematic journey has ended, but the visitor has only walked further into
 *  the building — this is not a new page. */
function ArchiveHall() {
  return (
    <div className="cw-archive__hall" aria-hidden="true">
      <div className="cw-world__ceiling" />
      <div className="cw-plane cw-plane--near"><HallNear /></div>
      <div className="cw-plane cw-plane--far"><HallFar /></div>
      <div className="cw-archive__wash" />
      <div className="cw-world__haze" />
      <div className="cw-archive__floor" />
      {/* Same shell as the departments: the records room is one more room in
          the building, so it is framed by the same jambs. */}
      <div className="cw-world__jambs" />
    </div>
  );
}

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
      {/* Beats 1 and 2, without choreography. The cinematic opening shows an
          idea, then the building that is about to act on it; stated linearly
          that is the same three things in the same order — the idea in the
          visitor's own words, the studios it is carried into, and the first
          department waiting on the other side of the threshold. The words are
          the same words: there is no second copy source. */}
      <section className="cw-static__act">
        <h1 className="cw-display">{OPEN.idea}</h1>
        <div className="cw-static__body">
          <blockquote className="cw-static__artifact">{ARTIFACT.line}</blockquote>
          <p className="cw-lede">{OPEN.turn}</p>
          <p className="cw-mono cw-mono--signal">
            {WORLD.facility} — {WORLD.thresholdLabel}
          </p>
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
        <div className="cw-panel cw-panel--record cw-static__panel">
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

      <section id="strategy" className="cw-static__act">
        <p className="cw-mono">Department {STRATEGY.index} — {STRATEGY.department}</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{STRATEGY.heading}</h2>
        <div className="cw-static__body">
          {STRATEGY.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-panel--record cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">{STRATEGY.panelTitle}</span>
            <span className="cw-mono">{STRATEGY.panelNote}</span>
          </div>
          <dl className="cw-record">
            {STRATEGY.rows.map((row) => (
              <div key={row.key} className="cw-record__row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="writers" className="cw-static__act">
        <p className="cw-mono">Department {WRITERS.index} — {WRITERS.department}</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{WRITERS.heading}</h2>
        <div className="cw-static__body">
          {WRITERS.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-panel--record cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">{WRITERS.panelTitle}</span>
            <span className="cw-mono">{WRITERS.panelNote}</span>
          </div>
          <dl className="cw-record">
            {WRITERS.rows.map((row) => (
              <div key={row.key} className="cw-record__row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="production" className="cw-static__act">
        <p className="cw-mono">Department {PRODUCTION.index} — {PRODUCTION.department}</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{PRODUCTION.heading}</h2>
        <div className="cw-static__body">
          {PRODUCTION.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-panel--record cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">{PRODUCTION.panelTitle}</span>
            <span className="cw-mono">{PRODUCTION.panelNote}</span>
          </div>
          <dl className="cw-record">
            {PRODUCTION.rows.map((row) => (
              <div key={row.key} className="cw-record__row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="control" className="cw-static__act">
        <p className="cw-mono">Department {CONTROL.index} — {CONTROL.department}</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{CONTROL.heading}</h2>
        <div className="cw-static__body">
          {CONTROL.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-panel--record cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">{CONTROL.panelTitle}</span>
            <span className="cw-mono">{CONTROL.panelNote}</span>
          </div>
          <dl className="cw-record">
            {CONTROL.rows.map((row) => (
              <div key={row.key} className="cw-record__row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="return" className="cw-static__act">
        {/* Beat 8, without the camera. The reduced-motion path cannot show the
            facility travelling back, so it states the same logic in order:
            the question that was attached in 02, the work it went through, the
            binding that brings it back, and the seam where the answer would
            land if the product measured it — which it does not. */}
        <p className="cw-mono">The Return — Department {RETURN.index}, revisited</p>
        <h2 className="cw-heading" style={{ marginTop: 16 }}>{RETURN.heading}</h2>
        <div className="cw-static__body">
          <blockquote className="cw-static__artifact">{ARTIFACT.hypothesis}</blockquote>
          {RETURN.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
        </div>
        <div className="cw-panel cw-panel--record cw-static__panel">
          <div className="cw-panel__bar">
            <span className="cw-mono">Hypothesis</span>
            <span className="cw-mono">{RETURN.verdict}</span>
          </div>
          <dl className="cw-record">
            <div className="cw-record__row">
              <dt>Binding</dt>
              <dd>{ARTIFACT.bound}</dd>
            </div>
            <div className="cw-record__row">
              <dt>Result</dt>
              <dd>{ARTIFACT.unmeasured}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Beat 9, without the camera. The same conclusion in the same order:
          the question, the binding, the seam it is waiting on, and the action.
          The result is not stated, because there is no result. */}
      <section id="finale" className="cw-static__act">
        <h2 className="cw-heading">{FINALE.heading}</h2>
        <div className="cw-static__body">
          {FINALE.body.map((paragraph) => (
            <p key={paragraph} className="cw-lede">{paragraph}</p>
          ))}
          <p className="cw-mono cw-mono--signal">
            {FINALE.verdict}
          </p>
          <div className="cw-open__actions" style={{ marginTop: 0 }}>
            <Link className="cw-cta cw-cta--solid" href="/login">{OPEN.primaryCta}</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export default function StudiosExperience() {
  const reduced = useReducedMotion();
  const stageScene = useStageScene();
  // Smoothing belongs to the cinematic path only: static mode is a document,
  // and a reduced-motion visitor has asked for the platform's own scrolling.
  useSmoothScroll(!reduced);
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

      <main id="main">
        {reduced ? (
          <StaticNarrative />
        ) : (
          /* One scroll span for the whole cinematic run. The world reads its
             progress from this element, which is why the facility can keep
             moving across a scene boundary that the scenes themselves cut on. */
          <div id={JOURNEY_ID} className="cw-journey">
            <StudiosWorld scope={JOURNEY_ID} />
            <ColdOpen />
            <IntelligenceRoom />
            <StrategyRoom />
            <WritersRoom />
            <ProductionFloor />
            <ControlRoom />
            <TheReturn />
            <NextDecision />
          </div>
        )}
        {reduced ? (
            <CapabilityRegister />
        ) : (
          <div className="cw-archive">
            <ArchiveHall />
            <CapabilityRegister />
            <Footer />
          </div>
        )}
      </main>

      {reduced ? <Footer /> : null}
      <span className="cw-preview-flag">Preview · /studios-preview</span>
    </div>
  );
}
