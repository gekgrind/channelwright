"use client";

import Link from "next/link";
import { CSSProperties } from "react";
import { Cue, Scene, useLightweightMode } from "./scene";
import { sceneTravel } from "./beats";
import { OpportunityPlot } from "./opportunity-plot";
import { VersionGate } from "./version-gate";
import { ScriptSequencer } from "./script-sequencer";
import { RenderLine } from "./render-line";
import { ReleaseCompositor } from "./control-room";
import { CONTROL, INTELLIGENCE, OPEN, PRODUCTION, STRATEGY, WRITERS } from "./copy";
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
    <Scene id="open" travel={sceneTravel("open")} className="cw-open" label="Channelwright Studios: cold open">
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
    <Scene id="intelligence" travel={sceneTravel("intelligence")} className="cw-room cw-scene--overlap" label="Department 01: Intelligence Room">
      {/* Atmosphere. The room's instrument is evidence the visitor feels
          rather than reads: full-bleed, behind everything, and never asked to
          be decoded. It keeps its own beats — the story it tells is true — but
          it is no longer a panel competing with the artifact. */}
      <div className="cw-layer cw-atmos" aria-hidden="true">
        <div className="cw-plot">
          {lightweight ? <span className="cw-plot__static" /> : <OpportunityPlot />}
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b3">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {INTELLIGENCE.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.74 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{INTELLIGENCE.verdict}</span>
              </div>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 02 -- */


/**
 * Department 02, established. It exists to prove the world grammar survives a
 * transition — the visitor arrives somewhere new without the building ever
 * changing — so it is composed, not elaborated.
 */
export function StrategyRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="strategy" travel={sceneTravel("strategy")} className="cw-room cw-room--02 cw-scene--overlap" label="Department 02: Strategy Room">
      {/* Atmosphere. The room's instrument is evidence the visitor feels
          rather than reads: full-bleed, behind everything, and never asked to
          be decoded. It keeps its own beats — the story it tells is true — but
          it is no longer a panel competing with the artifact. */}
      <div className="cw-layer cw-atmos" aria-hidden="true">
        <div className="cw-gate">
          {lightweight ? <span className="cw-gate__static" /> : <VersionGate />}
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b4">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {STRATEGY.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.62 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{STRATEGY.verdict}</span>
              </div>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 03 -- */


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
    <Scene id="writers" travel={sceneTravel("writers")} className="cw-room cw-room--03 cw-scene--overlap" label="Department 03: Writers' Room">
      {/* Atmosphere. The room's instrument is evidence the visitor feels
          rather than reads: full-bleed, behind everything, and never asked to
          be decoded. It keeps its own beats — the story it tells is true — but
          it is no longer a panel competing with the artifact. */}
      <div className="cw-layer cw-atmos" aria-hidden="true">
        <div className="cw-sequencer">
          {lightweight ? <span className="cw-sequencer__static" /> : <ScriptSequencer />}
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b5">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {WRITERS.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{WRITERS.verdict}</span>
              </div>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 04 -- */


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
    <Scene id="production" travel={sceneTravel("production")} className="cw-room cw-room--04 cw-scene--overlap" label="Department 04: Production Floor">
      {/* Atmosphere. The room's instrument is evidence the visitor feels
          rather than reads: full-bleed, behind everything, and never asked to
          be decoded. It keeps its own beats — the story it tells is true — but
          it is no longer a panel competing with the artifact. */}
      <div className="cw-layer cw-atmos" aria-hidden="true">
        <div className="cw-line">
          {lightweight ? <span className="cw-line__static" /> : <RenderLine />}
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b6">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {PRODUCTION.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{PRODUCTION.verdict}</span>
              </div>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 05 -- */


/**
 * Department 05, built to the standard set by 01–04. Where the Production
 * Floor resolves a script into a master it can release, the Control Room
 * resolves that master's packaging into the one exact release package a
 * human locks — an authoritative selection, not another QA conveyor.
 */
export function ControlRoom() {
  const lightweight = useLightweightMode();

  return (
    <Scene id="control" travel={sceneTravel("control")} className="cw-room cw-room--05 cw-scene--overlap" label="Department 05: Control Room">
      {/* Atmosphere. The room's instrument is evidence the visitor feels
          rather than reads: full-bleed, behind everything, and never asked to
          be decoded. It keeps its own beats — the story it tells is true — but
          it is no longer a panel competing with the artifact. */}
      <div className="cw-layer cw-atmos" aria-hidden="true">
        <div className="cw-console">
          {lightweight ? <span className="cw-console__static" /> : <ReleaseCompositor />}
        </div>
      </div>

      <div className="cw-layer cw-layer--copy">
        <Cue from={0.88} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b7">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {CONTROL.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.82 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{CONTROL.verdict}</span>
              </div>
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
