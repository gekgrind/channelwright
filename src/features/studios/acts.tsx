"use client";

import { CSSProperties } from "react";
import { Cue, Scene, useLightweightMode } from "./scene";
import { CAMERA, LIGHT, journeyAt, sceneProgress, sceneTravel } from "./beats";
import { OpportunityPlot } from "./opportunity-plot";
import { VersionGate } from "./version-gate";
import { ScriptSequencer } from "./script-sequencer";
import { RenderLine } from "./render-line";
import { ReleaseCompositor } from "./control-room";
import Link from "next/link";
import { CONTROL, FINALE, FOOTER, INTELLIGENCE, OPEN, PRODUCTION, RETURN, STRATEGY, WRITERS } from "./copy";
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

/**
 * Beats 1 and 2: the idea, and the world that is about to act on it.
 *
 * The pass-2 cold open was a landing page — eyebrow, three-line display
 * headline, positioning paragraph, two calls to action — stacked over a
 * building the visitor had not been shown yet. All of it is retired here.
 *
 * What is left is the sequence the rest of the run depends on:
 *
 *   Beat 1   One sentence, and the artifact it is about. At rest the artifact
 *            is the only lit thing in the frame and its plate carries the idea
 *            in the visitor's own words; the line resolves on the first small
 *            scroll gesture, so the opening rewards movement instead of taxing
 *            it with a screen of static hero.
 *   Beat 2   The turn. The building opens around the same artifact and the
 *            camera crosses the threshold with it.
 *
 * Neither beat owns any scenery: the reveal is the facility in `./world.tsx`
 * becoming legible by depth, which is why nothing is added here to compensate.
 */
export function ColdOpen() {
  return (
    <Scene id="open" travel={sceneTravel("open")} className="cw-open" label="Channelwright Studios: cold open">
      <div className="cw-layer cw-layer--copy">
        {/* Beat 1. One line, set against the artifact rather than above a
            paragraph, and carried out by its own exit so the boundary into
            Beat 2 is a camera move rather than a cut. */}
        <Cue from={0.46} to={0.6} className="cw-exit cw-open__beat cw-open__beat--idea">
          <div className="cw-shell cw-open__frame">
            <Cue from={0.05} to={0.22} as="header" className="cw-rise">
              <h1 className="cw-display cw-open__line">{OPEN.idea}</h1>
            </Cue>
          </div>
        </Cue>

        {/* Beat 2. Said once, high and small, while the widest shot in the run
            happens underneath it — then cleared before the crossing so the
            threshold is passed with nothing written across it. */}
        <Cue from={0.8} to={0.9} className="cw-exit cw-open__beat cw-open__beat--turn">
          <div className="cw-shell cw-open__frame cw-open__frame--turn">
            <Cue from={0.52} to={0.68} as="p" className="cw-rise cw-open__line cw-open__line--turn">
              {OPEN.turn}
            </Cue>
          </div>
        </Cue>
      </div>

      <Cue from={0.02} to={0.14} className="cw-scrollhint cw-hold">
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
        <Cue from={0.93} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b3">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {INTELLIGENCE.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.72 } as CSSProperties}>
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
        <Cue from={0.93} to={1} className="cw-exit">
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
        <Cue from={0.93} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b5">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {WRITERS.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.78 } as CSSProperties}>
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
        <Cue from={0.93} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b6">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {PRODUCTION.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.78 } as CSSProperties}>
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
        <Cue from={0.93} to={1} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b7">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={0.04} to={0.15} as="span" className="cw-rise cw-room__heading-line">
                  {CONTROL.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": 0.78 } as CSSProperties}>
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

/* ---------------------------------------------------------------- ACT 06 -- */

/**
 * Beat 8 — the Return. Department 02, revisited.
 *
 * This scene owns almost nothing. The beat is a camera move: `--rev` rises in
 * `studios.css`, the world travels back down the hall to the room where the
 * hypothesis was attached, holds there while the dormant question on the
 * artifact wakes, and then releases forward again. The copy arrives *after*
 * the traverse has already happened, because the visitor should recognise the
 * room before being told what it means.
 *
 * There is no instrument layer here, deliberately. Every other room has one
 * because something is being done to the artifact in it; here nothing is being
 * done to it, which is the point — the building is looking back, not working.
 * An instrument would also be the exact place a fabricated analytics readout
 * would creep in, and performance measurement is DESIGNED, not built.
 */
/* The camera's own moments, in the return scene's progress space.
   `sceneProgress` is the only correct bridge between a journey position and a
   `Cue`: the scenes overlap, so a scene's `--p` is not `at / travel`. Deriving
   these means retiming the camera retimes the copy with it. */
const SETTLED = sceneProgress("return", CAMERA.retrieve[1]);
const LEAVING = sceneProgress("return", CAMERA.release[0]);

export function TheReturn() {
  return (
    <Scene id="return" travel={sceneTravel("return")} className="cw-room cw-room--08 cw-scene--overlap" label="The Return: Department 02, revisited">
      <div className="cw-layer cw-layer--copy">
        {/* Later and shorter than a department's window. The copy arrives as the
            camera settles in Department 02, holds while the question resolves
            on the plate, and lifts as the release begins — so the beat is read
            in the order it happens: recognise the room, then be told why. */}
        <Cue from={LEAVING + 0.08} to={LEAVING + 0.18} className="cw-exit">
          <div className="cw-shell">
            <div className="cw-room__frame" data-beat="b8">
              <h2 className="cw-heading cw-room__headline">
                <Cue from={SETTLED + 0.02} to={SETTLED + 0.11} as="span" className="cw-rise cw-room__heading-line">
                  {RETURN.heading}
                </Cue>
              </h2>

              {/* One raised voice per room, and no caption under it. */}
              <div className="cw-verdict" style={{ "--at": SETTLED + 0.03 } as CSSProperties}>
                <span className="cw-verdict__mark" aria-hidden="true" />
                <span className="cw-verdict__line">{RETURN.verdict}</span>
              </div>
            </div>
          </div>
        </Cue>
      </div>
    </Scene>
  );
}

/* ---------------------------------------------------------------- ACT 07 -- */

/* The finale's copy is timed off the two things the world is doing, in this
   scene's own progress space. Deriving them means the beat keeps its rhythm
   when the scene's length changes — which is how the hold at the end was
   bought without slowing anything down, and why none of these numbers had to
   be re-tuned by hand when it was. `sceneProgress` is the only correct bridge:
   the scenes overlap, so a scene's `--p` is not `at / travel`. */

/** Where the door at the end of the hall has finished resolving. */
const SEAM_RESOLVED = sceneProgress("finale", LIGHT.seam[1]);

/** Where the plate has finished becoming a decision. The action is not
 *  offered before that has happened. */
export const HANDOFF_DONE = sceneProgress("finale", journeyAt("finale", 0.36));

/** Progress at which the action stops being decoration and becomes a link. */
export const ACTION_AT = Number((HANDOFF_DONE + 0.05).toFixed(3));

/**
 * Beat 9 — the Next Decision. The last room, and on purpose the shortest.
 *
 * The Return proved the facility remembers. This says what that memory is for:
 * a release is not the end of the work, it is what makes the next decision
 * answerable. The argument is made almost entirely in the building — the
 * artifact is set down at a door that is drawn in the same hand as the
 * entrance and left unlit, because `measurement` is DESIGNED and Channelwright
 * ingests no analytics today.
 *
 * The frame deliberately rhymes with Beat 1: darkness, one lit object, one
 * sentence, no chrome. The state is what has changed. An idea waiting to
 * become something, then a decision waiting for evidence.
 *
 * The action is the last thing to arrive, and it arrives on a discrete
 * `data-revealed` rather than a scrubbed opacity — an invisible link is still
 * a tab stop, and the visitor should not be able to reach the end of the
 * journey by keyboard before the journey has made its case.
 */
export function NextDecision() {
  return (
    <Scene
      id="finale"
      travel={sceneTravel("finale")}
      className="cw-room cw-room--09 cw-scene--overlap"
      label="The Next Decision"
      revealAt={ACTION_AT}
    >
      <div className="cw-layer cw-layer--copy">
        <div className="cw-shell">
          <div className="cw-room__frame" data-beat="b9">
            <h2 className="cw-heading cw-room__headline">
              <Cue from={SEAM_RESOLVED - 0.03} to={SEAM_RESOLVED + 0.07} as="span" className="cw-rise cw-room__heading-line">
                {FINALE.heading}
              </Cue>
            </h2>

            {/* One raised voice per room, and no caption under it. */}
            <div className="cw-verdict" style={{ "--at": SEAM_RESOLVED + 0.09 } as CSSProperties}>
              <span className="cw-verdict__mark" aria-hidden="true" />
              <span className="cw-verdict__line">{FINALE.verdict}</span>
            </div>

            {/* The visitor's turn. One action, the one the site has committed
                to everywhere else, and the only lit thing left in the frame. */}
            <div className="cw-finale__action">
              <Cue from={HANDOFF_DONE - 0.11} to={HANDOFF_DONE - 0.01} as="p" className="cw-rise cw-finale__line">
                {FOOTER.line}
              </Cue>
              <Link className="cw-cta cw-cta--solid cw-finale__cta" href="/login">
                {OPEN.primaryCta}
              </Link>
            </div>
          </div>
        </div>
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
