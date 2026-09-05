"use client";

import { CSSProperties, useEffect, useRef } from "react";
import { HallFar, HallMid, HallNear } from "./facility";
import { registerScene } from "./scroll-engine";
import { LANDMARK, SEAM, cameraVariables, lightVariables } from "./beats";
import { ArtifactPlate } from "./artifact-plate";
import { WORLD } from "./copy";
import { CAPABILITIES, DEPARTMENTS, STATUS_LABEL } from "./capabilities";

/**
 * The persistent Channelwright Studios facility.
 *
 * One fixed layer sits behind every scene for the whole cinematic run and is
 * driven by a single journey value `--j` (0..1 across all departments). Scenes
 * above it are transparent, so a scene boundary swaps content while the
 * building keeps sliding past — the visitor reads it as walking further into
 * one place rather than being cut to a new one.
 *
 * Everything here is declarative CSS off `--j`. The only JavaScript per frame
 * is the one custom-property write shared with the rest of the experience.
 */

type PropStyle = CSSProperties & Record<string, string | number>;

/** A landmark's journey position. Its drift rate — how fast it passes, and so
 *  how near it reads — is set per prop class in CSS. */
function prop(at: number): PropStyle {
  return { "--at": at };
}

/**
 * Department signage. Physically part of the back wall, so it drifts at the
 * far plane's rate and is legible from a long way off — Department 02's sign
 * is already visible on the right while the visitor is still in 01.
 */
function Sign({ at, index, name }: { at: number; index: string; name: string }) {
  return (
    <div className="cw-prop cw-sign" style={prop(at)}>
      <span className="cw-sign__index">{index}</span>
      <span className="cw-sign__name">{name}</span>
    </div>
  );
}

/**
 * An aperture the camera travels through. Scales past the viewer at the moment
 * it is reached, which is what turns "next section" into "next room".
 *
 * Two of these exist, and the difference between them is the whole argument of
 * the ending. The entrance is lit and the camera goes through it. The seam at
 * the far end — Department 06, where measurement would close the loop — is
 * drawn in the same hand and left dark, because `measurement` is DESIGNED and
 * Channelwright ingests no analytics today. The camera closes on it and the
 * building runs out.
 */
function Threshold({ at, mark, label, kind }: { at: number; mark: string; label: string; kind?: "seam" }) {
  return (
    <div className="cw-prop cw-threshold" data-kind={kind} style={prop(at)}>
      <span className="cw-threshold__frame" />
      {/* The building names itself on its own lintel. The cold open used to
          resolve out of an unlabelled rectangle in the dark, which read as
          unfinished rather than withheld — the visitor should know what they
          are walking into before the first department arrives. */}
      <span className="cw-threshold__mark">{mark}</span>
      <span className="cw-threshold__label">{label}</span>
    </div>
  );
}

/**
 * Department 06, read off the same register the capability table renders — and
 * so is the status painted on its lintel. If measurement ever stops being
 * DESIGNED, the door relabels itself rather than quietly continuing to say
 * something the register no longer supports.
 */
const ANALYTICS = DEPARTMENTS.find((department) => department.index === "06")!;
const MEASUREMENT = CAPABILITIES.find((capability) => capability.id === "measurement")!;
export const SEAM_LABEL = STATUS_LABEL[MEASUREMENT.status];

/** Glazed divider between operating areas: the visible seam that keeps two
 *  departments adjacent rather than merely sequential. */
function Partition({ at }: { at: number }) {
  return (
    <div className="cw-prop cw-partition" style={prop(at)}>
      <span className="cw-partition__glass" />
      <span className="cw-partition__transom" />
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className="cw-partition__mullion" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * A department's own equipment, standing where that department stands.
 *
 * Without this every room is the same generic hall with different words over
 * it. Department 01 works against a wall of research monitors; Department 02
 * works against a decision board. The tint carries the difference at a glance,
 * before any copy is read.
 */
function Fixture({ at, kind }: { at: number; kind: "research" | "decision" | "writers" | "production" | "control" }) {
  return (
    <div className="cw-prop cw-fixture" data-kind={kind} style={prop(at)}>
      {Array.from({ length: kind === "research" ? 16 : kind === "decision" ? 8 : kind === "control" ? 10 : 12 }, (_, index) => (
        <span key={index} className="cw-fixture__cell" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * The conveyance line the artifact travels along. It is drawn at the same
 * height in every department, so the eye tracks one continuous route through
 * the building instead of re-locating itself after each transition.
 */
function ConveyanceLine() {
  return (
    <div className="cw-conveyance" aria-hidden="true">
      <span className="cw-conveyance__rail" />
      <span className="cw-conveyance__marks" />
    </div>
  );
}

export function StudiosWorld({ scope }: { scope: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const world = ref.current;
    const journey = document.getElementById(scope);
    if (!world || !journey) return;

    let last = -1;
    let lastOn: boolean | null = null;

    return registerScene({
      element: journey,
      apply(progress, onStage) {
        const value = Math.round(progress * 1000) / 1000;
        if (value !== last) {
          last = value;
          world.style.setProperty("--j", String(value));
        }
        if (onStage !== lastOn) {
          lastOn = onStage;
          world.dataset.live = onStage ? "true" : "false";
        }
      },
    });
  }, [scope]);

  return (
    <div
      className="cw-world"
      ref={ref}
      data-live="false"
      aria-hidden="true"
      /* Journey positions for every light cue and environmental gate, derived
         from the scene lengths in `./beats.ts` rather than written into the
         stylesheet as bare decimals. Lengthening the cold open to hold Beats 1
         and 2 moves all of them together, so the building's light stays tied
         to the room it belongs to instead of to a scroll fraction. The camera
         set carries Beat 8's return: where it goes back to, and the two
         windows across which it goes and comes back. */
      style={{ ...lightVariables(), ...cameraVariables() } as CSSProperties}
    >
      {/* Ambient light. Interpolated rather than switched, so the colour of
          Department 01 has already begun bleeding into the approach corridor. */}
      <div className="cw-world__ambient" />
      <div className="cw-world__beam" />

      {/* Room shell. Ceiling first, so every plane below is read against a
          surface rather than against void. */}
      <div className="cw-world__ceiling" />

      {/* Depth planes, slowest first. */}
      <div className="cw-plane cw-plane--far"><HallFar /></div>

      <Fixture at={LANDMARK.dept01} kind="research" />
      <Fixture at={LANDMARK.dept02} kind="decision" />
      <Fixture at={LANDMARK.dept03} kind="writers" />
      <Fixture at={LANDMARK.dept04} kind="production" />
      <Fixture at={LANDMARK.dept05} kind="control" />

      <Sign at={LANDMARK.dept01} index={WORLD.dept01.index} name={WORLD.dept01.name} />
      <Sign at={LANDMARK.dept02} index={WORLD.dept02.index} name={WORLD.dept02.name} />
      <Sign at={LANDMARK.dept03} index={WORLD.dept03.index} name={WORLD.dept03.name} />
      <Sign at={LANDMARK.dept04} index={WORLD.dept04.index} name={WORLD.dept04.name} />
      <Sign at={LANDMARK.dept05} index={WORLD.dept05.index} name={WORLD.dept05.name} />

      <div className="cw-plane cw-plane--mid"><HallMid /></div>

      <div className="cw-world__floor" />
      {/* Deck: the near half of the floor as a solid, with one lit leading
          edge. It occludes the bottom of the operating floor, which is what
          separates "midground" from "the plane I am standing on" — depth the
          floor grid alone could only imply. */}
      <div className="cw-world__deck" />
      <ConveyanceLine />

      <Partition at={LANDMARK.partition} />
      <Partition at={LANDMARK.partition02to03} />
      <Partition at={LANDMARK.partition03to04} />
      <Partition at={LANDMARK.partition04to05} />
      <div className="cw-plane cw-plane--near"><HallNear /></div>
      <Threshold at={LANDMARK.threshold} mark={WORLD.facility} label={WORLD.thresholdLabel} />
      {/* Beat 9. Named off `./capabilities.ts` rather than restated here, so
          the door on the wall and the row in the register can never disagree
          about what is built. */}
      <Threshold
        at={SEAM}
        kind="seam"
        mark={`${ANALYTICS.index} \u2014 ${ANALYTICS.name}`}
        label={SEAM_LABEL}
      />

      {/* Foreground jambs: unlit structure the visitor is standing between.
          Nothing is drawn on them — their whole job is to occlude the room's
          edges, so the eye reads a near plane, a room plane and a far plane
          instead of one flat field of linework. */}
      <div className="cw-world__jambs" />

      {/* Depth haze: the far end of the hall is never fully resolved, which is
          what keeps the building feeling longer than the page. */}
      <div className="cw-world__haze" />

      {/* The artifact rides in front of the building, not inside it: it is the
          thing being looked at, and the hall is where that happens. */}
      <ArtifactPlate />

      <div className="cw-world__vignette" />
    </div>
  );
}
