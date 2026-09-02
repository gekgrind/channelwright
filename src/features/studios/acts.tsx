"use client";

import Link from "next/link";
import { CSSProperties } from "react";
import { Cue, Scene, useLightweightMode } from "./scene";
import { OpportunityPlot } from "./opportunity-plot";
import { VersionGate } from "./version-gate";
import { INTELLIGENCE, OPEN, STRATEGY } from "./copy";
import { CAPABILITIES, STATUS_LABEL } from "./capabilities";

/**
 * The departments of Channelwright Studios.
 *
 * Scenes here own *content only*. The building — truss, cable runs, back wall,
 * equipment galleries, floor and the travelling signal — lives once in
 * `./world.tsx` and is visible through every stage, so crossing from one
 * department to the next swaps what is being said without ever cutting the
 * place it is being said in.
 *
 * Each scene therefore ends with an explicit exit cue rather than simply
 * running out of scroll: copy lifts and clears as the camera moves on.
 */

/* ---------------------------------------------------------------- ACT 00 -- */

export function ColdOpen() {
  return (
    <Scene id="open" travel={3.4} className="cw-open" label="Channelwright Studios: cold open">
      {/* Slate lines, set like subtitles rather than a headline. */}
      <div className="cw-layer">
        <div className="cw-open__slate">
          <Cue from={-0.12} to={0.22} as="p" className="cw-mono cw-pulse cw-open__line">
            {OPEN.slate[0]}
          </Cue>
          <Cue from={0.18} to={0.46} as="p" className="cw-mono cw-pulse cw-open__line">
            {OPEN.slate[1]}
          </Cue>
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        {/* One exit cue carries the whole stack out, so the boundary into
            Department 01 is a camera move rather than a cut. */}
        <Cue from={0.9} to={1} className="cw-exit cw-open__exit">
          <div className="cw-shell cw-open__copy">
            <Cue from={0.42} to={0.58} as="p" className="cw-mono cw-mono--signal cw-rise cw-open__over">
              {OPEN.overline}
            </Cue>
            <h1 className="cw-display cw-display--xl cw-open__title">
              {OPEN.title.map((line, index) => (
                <Cue
                  key={line}
                  from={0.44 + index * 0.04}
                  to={0.62 + index * 0.04}
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
        </Cue>
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
    <Scene id="intelligence" travel={4.2} className="cw-room cw-scene--overlap" label="Department 01: Intelligence Room">
      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__grid">
              <div className="cw-room__brief">
                <Cue from={0} to={0.05} as="p" className="cw-mono cw-rise cw-room__kicker">
                  Department {INTELLIGENCE.index} — {INTELLIGENCE.department}
                </Cue>
                <h2 className="cw-heading">
                  {/* Rise, not wipe: an inset clip across wrapped lines cuts the
                      first line mid-word while later lines are already whole. */}
                  <Cue from={0.02} to={0.14} as="span" className="cw-rise cw-room__heading-line">
                    {INTELLIGENCE.heading}
                  </Cue>
                </h2>
                <Cue from={0.04} to={0.18} as="p" className="cw-lede cw-rise">
                  {INTELLIGENCE.body[0]}
                </Cue>

                <Cue from={0.14} to={0.28} className="cw-panel cw-rise cw-stream-panel">
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
                        style={{ "--at": 0.3 + index * 0.055 } as CSSProperties}
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

              <Cue from={0.06} to={0.2} className="cw-instrument cw-rise">
                {/* The panel brightens while the signal is inside it. */}
                <div className="cw-panel cw-panel--live">
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

                  {/* Read-out: what the field is actually doing, in words, so
                      the motion is never the only thing carrying the claim. */}
                  <div className="cw-readout">
                    {INTELLIGENCE.readout.map((cell) => (
                      <div
                        key={cell.label}
                        className="cw-readout__cell"
                        data-terminal={cell.at > 0.6 ? "true" : undefined}
                        style={{ "--at": cell.at } as CSSProperties}
                      >
                        <span className="cw-readout__value">{cell.value}</span>
                        <span className="cw-readout__label">{cell.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="cw-ledger">
                    {INTELLIGENCE.ledger.map((cell) => (
                      <div key={cell.value} className="cw-ledger__cell" data-tone={cell.tone}>
                        <span className="cw-ledger__value">{cell.value}</span>
                        <span className="cw-mono cw-ledger__note">{cell.note}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Verdict. The room's one moment of raised voice. */}
                <div className="cw-verdict" style={{ "--at": 0.74 } as CSSProperties}>
                  <span className="cw-verdict__mark" aria-hidden="true" />
                  <span className="cw-verdict__line">{INTELLIGENCE.verdict}</span>
                  <span className="cw-verdict__note">{INTELLIGENCE.rejected}</span>
                </div>
              </Cue>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 02 -- */

const STRATEGY_CAPABILITIES = CAPABILITIES.filter((capability) => capability.department === "02");

/**
 * Department 02, established. It exists to prove the world grammar survives a
 * transition — the visitor arrives somewhere new without the building ever
 * changing — so it is composed, not elaborated.
 */
export function StrategyRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="strategy" travel={3.6} className="cw-room cw-room--02 cw-scene--overlap" label="Department 02: Strategy Room">
      <div className="cw-layer cw-layer--copy">
        <Cue from={0.9} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__grid cw-room__grid--02">
              <div className="cw-room__brief">
                <Cue from={0} to={0.1} as="p" className="cw-mono cw-rise cw-room__kicker">
                  Department {STRATEGY.index} — {STRATEGY.department}
                </Cue>
                <h2 className="cw-heading">
                  <Cue from={0.03} to={0.2} as="span" className="cw-rise cw-room__heading-line">
                    {STRATEGY.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.32} as="p" className="cw-lede cw-rise">
                  {STRATEGY.body[0]}
                </Cue>

                <Cue from={0.2} to={0.4} className="cw-panel cw-rise">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{STRATEGY.panelTitle}</span>
                    <span className="cw-mono">{STRATEGY.panelNote}</span>
                  </div>
                  <dl className="cw-record">
                    {STRATEGY.rows.map((row, index) => (
                      <div key={row.key} className="cw-record__row" style={{ "--at": 0.34 + index * 0.07 } as CSSProperties}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="cw-record__foot">
                    {STRATEGY_CAPABILITIES.map((capability) => (
                      <span key={capability.id} className="cw-status" data-status={capability.status}>
                        {STATUS_LABEL[capability.status]}
                      </span>
                    ))}
                  </div>
                </Cue>
              </div>

              <Cue from={0.1} to={0.26} className="cw-instrument cw-rise">
                {/* The panel brightens while the approved signal is passing
                    through the gate. */}
                <div className="cw-panel cw-panel--live">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{STRATEGY.instrumentTitle}</span>
                    <span className="cw-mono">{STRATEGY.instrumentNote}</span>
                  </div>
                  <div className="cw-gate">
                    {lightweight ? <span className="cw-gate__static" /> : <VersionGate />}
                  </div>

                  <div className="cw-readout">
                    {STRATEGY.readout.map((cell) => (
                      <div
                        key={cell.label}
                        className="cw-readout__cell"
                        data-terminal={cell.at > 0.6 ? "true" : undefined}
                        style={{ "--at": cell.at } as CSSProperties}
                      >
                        <span className="cw-readout__value">{cell.value}</span>
                        <span className="cw-readout__label">{cell.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Verdict, in the same register as Department 01's. */}
                <div className="cw-verdict" style={{ "--at": 0.62 } as CSSProperties}>
                  <span className="cw-verdict__mark" aria-hidden="true" />
                  <span className="cw-verdict__line">{STRATEGY.verdict}</span>
                  <span className="cw-verdict__note">{STRATEGY.rejected}</span>
                </div>
              </Cue>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ------------------------------------------------------- static-mode reuse */

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
