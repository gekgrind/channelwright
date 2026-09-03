"use client";

import Link from "next/link";
import { CSSProperties } from "react";
import { Cue, Scene, useLightweightMode } from "./scene";
import { OpportunityPlot } from "./opportunity-plot";
import { VersionGate } from "./version-gate";
import { ScriptSequencer } from "./script-sequencer";
import { RenderLine } from "./render-line";
import { ReleaseCompositor } from "./control-room";
import { CONTROL, INTELLIGENCE, OPEN, PRODUCTION, STRATEGY, WORLD, WRITERS } from "./copy";
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
                <Cue from={0} to={0.05} className="cw-rise cw-room__plate">
                  <span className="cw-room__plate-index">{INTELLIGENCE.index}</span>
                  <span className="cw-room__plate-name">{INTELLIGENCE.department}</span>
                  <span className="cw-room__plate-note">{WORLD.dept01.note}</span>
                </Cue>
                <h2 className="cw-heading">
                  {/* Rise, not wipe: an inset clip across wrapped lines cuts the
                      first line mid-word while later lines are already whole. */}
                  <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                    {INTELLIGENCE.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.24} as="p" className="cw-lede cw-rise">
                  {INTELLIGENCE.body[0]}
                </Cue>

                <Cue from={0.36} to={0.48} className="cw-panel cw-panel--record cw-rise--solid cw-stream-panel">
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
                        style={{ "--at": 0.5 + index * 0.045 } as CSSProperties}
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

              <Cue from={0.2} to={0.32} className="cw-instrument cw-rise--solid">
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
                <Cue from={0} to={0.05} className="cw-rise cw-room__plate">
                  <span className="cw-room__plate-index">{STRATEGY.index}</span>
                  <span className="cw-room__plate-name">{STRATEGY.department}</span>
                  <span className="cw-room__plate-note">{WORLD.dept02.note}</span>
                </Cue>
                <h2 className="cw-heading">
                  <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                    {STRATEGY.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.24} as="p" className="cw-lede cw-rise">
                  {STRATEGY.body[0]}
                </Cue>

                <Cue from={0.36} to={0.48} className="cw-panel cw-panel--record cw-rise--solid">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{STRATEGY.panelTitle}</span>
                    <span className="cw-mono">{STRATEGY.panelNote}</span>
                  </div>
                  <dl className="cw-record">
                    {STRATEGY.rows.map((row, index) => (
                      <div key={row.key} className="cw-record__row" style={{ "--at": 0.5 + index * 0.05 } as CSSProperties}>
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

              <Cue from={0.2} to={0.32} className="cw-instrument cw-rise--solid">
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

/* ---------------------------------------------------------------- ACT 03 -- */

const WRITERS_CAPABILITIES = CAPABILITIES.filter((capability) => capability.department === "03");

/**
 * Department 03, built to the standard set by 01 and 02. Where the Strategy
 * Room resolves candidate positions into one approved decision, the Writers'
 * Room resolves that decision into a script it can defend — sections
 * assembling in order, one caught by QA and corrected in place, then locked
 * and handed to Production.
 */
export function WritersRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="writers" travel={4} className="cw-room cw-room--03 cw-scene--overlap" label="Department 03: Writers' Room">
      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__grid cw-room__grid--03">
              <div className="cw-room__brief">
                <Cue from={0} to={0.05} className="cw-rise cw-room__plate">
                  <span className="cw-room__plate-index">{WRITERS.index}</span>
                  <span className="cw-room__plate-name">{WRITERS.department}</span>
                  <span className="cw-room__plate-note">{WORLD.dept03.note}</span>
                </Cue>
                <h2 className="cw-heading">
                  <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                    {WRITERS.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.24} as="p" className="cw-lede cw-rise">
                  {WRITERS.body[0]}
                </Cue>

                <Cue from={0.36} to={0.48} className="cw-panel cw-panel--record cw-rise--solid">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{WRITERS.panelTitle}</span>
                    <span className="cw-mono">{WRITERS.panelNote}</span>
                  </div>
                  <dl className="cw-record">
                    {WRITERS.rows.map((row, index) => (
                      <div key={row.key} className="cw-record__row" style={{ "--at": 0.5 + index * 0.05 } as CSSProperties}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="cw-record__foot">
                    {WRITERS_CAPABILITIES.map((capability) => (
                      <span key={capability.id} className="cw-status" data-status={capability.status}>
                        {STATUS_LABEL[capability.status]}
                      </span>
                    ))}
                  </div>
                </Cue>
              </div>

              <Cue from={0.2} to={0.32} className="cw-instrument cw-rise--solid">
                {/* The panel brightens while the sequence is being assembled
                    and checked. */}
                <div className="cw-panel cw-panel--live">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{WRITERS.instrumentTitle}</span>
                    <span className="cw-mono">{WRITERS.instrumentNote}</span>
                  </div>
                  <div className="cw-sequencer">
                    {lightweight ? <span className="cw-sequencer__static" /> : <ScriptSequencer />}
                  </div>

                  <div className="cw-readout">
                    {WRITERS.readout.map((cell) => (
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

                {/* Verdict, in the same register as Departments 01 and 02. */}
                <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                  <span className="cw-verdict__mark" aria-hidden="true" />
                  <span className="cw-verdict__line">{WRITERS.verdict}</span>
                  <span className="cw-verdict__note">{WRITERS.rejected}</span>
                </div>
              </Cue>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 04 -- */

const PRODUCTION_CAPABILITIES = CAPABILITIES.filter((capability) => capability.department === "04");

/**
 * Department 04, built to the standard set by 01–03. Where the Writers' Room
 * resolves a brief into a script it can defend, the Production Floor
 * resolves that script into a master it can release — rendered once, then
 * held on the line until every independent QA gate reports a pass and a
 * human approves the exact version that did.
 */
export function ProductionFloor() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="production" travel={4} className="cw-room cw-room--04 cw-scene--overlap" label="Department 04: Production Floor">
      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__grid cw-room__grid--04">
              <div className="cw-room__brief">
                <Cue from={0} to={0.05} className="cw-rise cw-room__plate">
                  <span className="cw-room__plate-index">{PRODUCTION.index}</span>
                  <span className="cw-room__plate-name">{PRODUCTION.department}</span>
                  <span className="cw-room__plate-note">{WORLD.dept04.note}</span>
                </Cue>
                <h2 className="cw-heading">
                  <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                    {PRODUCTION.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.24} as="p" className="cw-lede cw-rise">
                  {PRODUCTION.body[0]}
                </Cue>

                <Cue from={0.36} to={0.48} className="cw-panel cw-panel--record cw-rise--solid">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{PRODUCTION.panelTitle}</span>
                    <span className="cw-mono">{PRODUCTION.panelNote}</span>
                  </div>
                  <dl className="cw-record">
                    {PRODUCTION.rows.map((row, index) => (
                      <div key={row.key} className="cw-record__row" style={{ "--at": 0.5 + index * 0.05 } as CSSProperties}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="cw-record__foot">
                    {PRODUCTION_CAPABILITIES.map((capability) => (
                      <span key={capability.id} className="cw-status" data-status={capability.status}>
                        {STATUS_LABEL[capability.status]}
                      </span>
                    ))}
                  </div>
                </Cue>
              </div>

              <Cue from={0.2} to={0.32} className="cw-instrument cw-rise--solid">
                {/* The panel brightens while the master is being rendered
                    and swept through the gates. */}
                <div className="cw-panel cw-panel--live">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{PRODUCTION.instrumentTitle}</span>
                    <span className="cw-mono">{PRODUCTION.instrumentNote}</span>
                  </div>
                  <div className="cw-line">
                    {lightweight ? <span className="cw-line__static" /> : <RenderLine />}
                  </div>

                  <div className="cw-readout">
                    {PRODUCTION.readout.map((cell) => (
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

                {/* Verdict, in the same register as Departments 01–03. */}
                <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                  <span className="cw-verdict__mark" aria-hidden="true" />
                  <span className="cw-verdict__line">{PRODUCTION.verdict}</span>
                  <span className="cw-verdict__note">{PRODUCTION.rejected}</span>
                </div>
              </Cue>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 05 -- */

const CONTROL_CAPABILITIES = CAPABILITIES.filter((capability) => capability.department === "05");

/**
 * Department 05, built to the standard set by 01–04. Where the Production
 * Floor resolves a script into a master it can release, the Control Room
 * resolves that master's packaging into the one exact release package a
 * human locks — an authoritative selection, not another QA conveyor.
 */
export function ControlRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="control" travel={4} className="cw-room cw-room--05 cw-scene--overlap" label="Department 05: Control Room">
      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__grid cw-room__grid--05">
              <div className="cw-room__brief">
                <Cue from={0} to={0.05} className="cw-rise cw-room__plate">
                  <span className="cw-room__plate-index">{CONTROL.index}</span>
                  <span className="cw-room__plate-name">{CONTROL.department}</span>
                  <span className="cw-room__plate-note">{WORLD.dept05.note}</span>
                </Cue>
                <h2 className="cw-heading">
                  <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                    {CONTROL.heading}
                  </Cue>
                </h2>
                <Cue from={0.12} to={0.24} as="p" className="cw-lede cw-rise">
                  {CONTROL.body[0]}
                </Cue>

                <Cue from={0.36} to={0.48} className="cw-panel cw-panel--record cw-rise--solid">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{CONTROL.panelTitle}</span>
                    <span className="cw-mono">{CONTROL.panelNote}</span>
                  </div>
                  <dl className="cw-record">
                    {CONTROL.rows.map((row, index) => (
                      <div key={row.key} className="cw-record__row" style={{ "--at": 0.5 + index * 0.05 } as CSSProperties}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="cw-record__foot">
                    {CONTROL_CAPABILITIES.map((capability) => (
                      <span key={capability.id} className="cw-status" data-status={capability.status}>
                        {STATUS_LABEL[capability.status]}
                      </span>
                    ))}
                  </div>
                </Cue>
              </div>

              <Cue from={0.2} to={0.32} className="cw-instrument cw-rise--solid">
                {/* The panel brightens while candidates are assessed and the
                    release package is being composited and locked. */}
                <div className="cw-panel cw-panel--live">
                  <div className="cw-panel__bar">
                    <span className="cw-mono">{CONTROL.instrumentTitle}</span>
                    <span className="cw-mono">{CONTROL.instrumentNote}</span>
                  </div>
                  <div className="cw-console">
                    {lightweight ? <span className="cw-console__static" /> : <ReleaseCompositor />}
                  </div>

                  <div className="cw-readout">
                    {CONTROL.readout.map((cell) => (
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

                {/* Verdict, in the same register as Departments 01–04. */}
                <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                  <span className="cw-verdict__mark" aria-hidden="true" />
                  <span className="cw-verdict__line">{CONTROL.verdict}</span>
                  <span className="cw-verdict__note">{CONTROL.rejected}</span>
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
