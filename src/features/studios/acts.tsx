"use client";

import Link from "next/link";
import { Cue, Scene, useLightweightMode } from "./scene";
import { ArchitectureFar, ArchitectureNear } from "./architecture";
import { OpportunityPlot } from "./opportunity-plot";
import { INTELLIGENCE, OPEN } from "./copy";
import { CAPABILITIES, STATUS_LABEL } from "./capabilities";

const LED_COUNT = 26;
const SIGNAL_LEDS = new Set([4, 11, 19]);

/* Deliberately asymmetric: a mirrored gallery reads as a template rather than
   a room someone actually built. */
const SCREENS = [
  { left: "5%", top: "31%", width: "14%", height: "10%", depth: 0.62 },
  { left: "20.5%", top: "34.5%", width: "10%", height: "7%", depth: 0.4 },
  { left: "31.5%", top: "36%", width: "7%", height: "5%", depth: 0.26 },
  { right: "7%", top: "29%", width: "11%", height: "8%", depth: 0.52 },
  { right: "19.5%", top: "33%", width: "8%", height: "5.5%", depth: 0.32 },
];

/* ---------------------------------------------------------------- ACT 00 -- */

export function ColdOpen() {
  return (
    <Scene id="open" travel={4} className="cw-open" label="Channelwright Studios: cold open">
      <Cue from={0} to={0.46} className="cw-open__vault" />
      <Cue from={0.14} to={0.62} className="cw-open__floor" />

      <Cue from={0.14} to={0.52} className="cw-open__beam" />

      <Cue from={0.18} to={0.58} className="cw-arch cw-arch--far">
        <ArchitectureFar />
      </Cue>
      <Cue from={0.24} to={0.68} className="cw-arch cw-arch--near">
        <ArchitectureNear />
      </Cue>

      <Cue from={0.3} to={0.64} className="cw-layer">
        <div className="cw-screens">
          {SCREENS.map((screen, index) => (
            <span
              key={index}
              className="cw-screens__unit"
              style={{ ...screen, ["--depth" as string]: screen.depth }}
            />
          ))}
        </div>
      </Cue>

      <Cue from={0.2} to={0.56} className="cw-layer">
        <div className="cw-leds" aria-hidden="true">
          {Array.from({ length: LED_COUNT }, (_, index) => (
            <span
              key={index}
              className="cw-leds__dot"
              data-signal={SIGNAL_LEDS.has(index) ? "true" : undefined}
              style={{ ["--i" as string]: index }}
            />
          ))}
        </div>
      </Cue>

      <Cue from={0} to={0.62} className="cw-spark cw-spark--open">
        <span className="cw-spark__halo" />
      </Cue>

      {/* Slate lines, set like subtitles rather than a headline. */}
      <div className="cw-layer">
        <div className="cw-open__slate">
          {/* Starts already lit: the first line is the visitor's entry point. */}
          <Cue from={-0.12} to={0.2} as="p" className="cw-mono cw-pulse cw-open__line">
            {OPEN.slate[0]}
          </Cue>
          <Cue from={0.16} to={0.42} as="p" className="cw-mono cw-pulse cw-open__line">
            {OPEN.slate[1]}
          </Cue>
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <div className="cw-shell cw-open__copy">
          <Cue from={0.4} to={0.56} as="p" className="cw-mono cw-mono--signal cw-rise cw-open__over">
            {OPEN.overline}
          </Cue>
          <h1 className="cw-display cw-display--xl cw-open__title">
            {OPEN.title.map((line, index) => (
              <Cue
                key={line}
                from={0.42 + index * 0.04}
                to={0.6 + index * 0.04}
                as="span"
                className="cw-wipe cw-open__title-line"
              >
                {line.startsWith(OPEN.emphasis) ? (
                  <>
                    <em>{OPEN.emphasis}</em>
                    {line.slice(OPEN.emphasis.length)}
                  </>
                ) : (
                  line
                )}{" "}
              </Cue>
            ))}
          </h1>
          <Cue from={0.6} to={0.74} as="p" className="cw-lede cw-rise cw-open__lede">
            {OPEN.lede}
          </Cue>
          <Cue from={0.66} to={0.8} className="cw-rise cw-open__actions">
            <Link className="cw-cta cw-cta--solid" href="/login">
              {OPEN.primaryCta}
            </Link>
            <a className="cw-cta cw-cta--ghost" href="#register">
              {OPEN.secondaryCta}
            </a>
          </Cue>
        </div>
      </div>

      <Cue from={0} to={0.12} className="cw-scrollhint cw-hold">
        <span className="cw-scrollhint__bar" />
        <span className="cw-mono">{OPEN.hint}</span>
      </Cue>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 01 -- */

const INTELLIGENCE_CAPABILITIES = CAPABILITIES.filter((capability) => capability.department === "01");

export function IntelligenceRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="intelligence" travel={3.4} className="cw-room" label="Department 01: Intelligence Room">
      <Cue from={0} to={0.28} className="cw-room__ambient" />
      <Cue from={0.02} to={0.34} className="cw-room__floor" />

      <Cue from={-0.1} to={0.42} as="span" className="cw-artifact" aria-hidden="true">
        {INTELLIGENCE.artifactBefore}
      </Cue>
      <Cue from={0.5} to={1.06} as="span" className="cw-artifact" aria-hidden="true">
        {INTELLIGENCE.artifactAfter}
      </Cue>

      <div className="cw-layer cw-layer--copy">
        <div className="cw-shell">
          <div className="cw-room__grid">
            <div className="cw-room__brief">
              <Cue from={0.01} to={0.1} as="p" className="cw-mono cw-rise cw-room__kicker">
                Department {INTELLIGENCE.index} — {INTELLIGENCE.department}
              </Cue>
              <h2 className="cw-heading">
                {/* Rise, not wipe: an inset clip across wrapped lines cuts the first
                    line mid-word while later lines are already complete. */}
                <Cue from={0.03} to={0.16} as="span" className="cw-rise cw-room__heading-line">
                  {INTELLIGENCE.heading}
                </Cue>
              </h2>
              <Cue from={0.07} to={0.2} as="p" className="cw-lede cw-rise">
                {INTELLIGENCE.body[0]}
              </Cue>

              <Cue from={0.12} to={0.26} className="cw-panel cw-rise cw-stream-panel">
                <div className="cw-panel__bar">
                  <span className="cw-mono">{INTELLIGENCE.streamTitle}</span>
                  <span className="cw-mono">{INTELLIGENCE.streamNote}</span>
                </div>
                <ol className="cw-stream">
                  {INTELLIGENCE.steps.map((step, index) => (
                    <li
                      key={step.key}
                      className="cw-stream__step"
                      data-role={"role" in step ? step.role : undefined}
                      style={{ ["--at" as string]: 0.24 + index * 0.05 }}
                    >
                      <span className="cw-stream__pip" aria-hidden="true" />
                      <span>{step.label}</span>
                      <span className="cw-stream__tag">{step.tag}</span>
                    </li>
                  ))}
                </ol>
                <p className="cw-stream__digest cw-mono">
                  Seven steps · independent QA · bounded revision · human approval
                </p>
              </Cue>
            </div>

            <Cue from={0.04} to={0.18} className="cw-panel cw-rise">
              <div className="cw-panel__bar">
                <span className="cw-mono">{INTELLIGENCE.panelTitle}</span>
                <span className="cw-mono">{INTELLIGENCE.panelNote}</span>
              </div>
              <div className="cw-plot">
                {lightweight ? <span className="cw-plot__static" /> : <OpportunityPlot />}
                <div className="cw-plot__axes" aria-hidden="true">
                  <span className="cw-plot__frame" />
                  <span className="cw-plot__axis cw-plot__axis--y">↑ {INTELLIGENCE.axisY}</span>
                  <span className="cw-plot__axis cw-plot__axis--x">→ {INTELLIGENCE.axisX}</span>
                </div>
              </div>
              <div className="cw-ledger">
                {INTELLIGENCE.ledger.map((cell) => (
                  <div key={cell.value} className="cw-ledger__cell" data-tone={cell.tone}>
                    <span className="cw-ledger__value">{cell.value}</span>
                    <span className="cw-mono cw-ledger__note">{cell.note}</span>
                  </div>
                ))}
              </div>
            </Cue>
          </div>
        </div>
      </div>
    </Scene>
  );
}

export function IntelligenceCapabilities() {
  return (
    <>
      {INTELLIGENCE_CAPABILITIES.map((capability) => (
        <div key={capability.id} className="cw-capability">
          <div className="cw-capability__head">
            <span className="cw-capability__name">{capability.name}</span>
            <span className="cw-status" data-status={capability.status}>
              {STATUS_LABEL[capability.status]}
            </span>
          </div>
          <p className="cw-capability__claim">{capability.claim}</p>
          {capability.boundary ? <p className="cw-capability__boundary">{capability.boundary}</p> : null}
        </div>
      ))}
    </>
  );
}
