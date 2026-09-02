"use client";

import { CSSProperties, useEffect, useRef } from "react";
import { HallFar, HallMid, HallNear } from "./facility";
import { registerScene } from "./scroll-engine";
import { SIGNAL, WORLD } from "./copy";

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

/**
 * Journey positions of the fixed landmarks, in `--j` units.
 *
 * `--j` is a fraction of the *whole* journey, so adding Department 03
 * lengthened the building and shrank every existing fraction — each value
 * below is the pre-03 position rescaled by the ratio of old to new
 * scrollable travel, which keeps every prop at the same absolute scroll
 * distance it held before. New 03 landmarks are placed at the same
 * proportion into their scene that Department 02's held into its own,
 * so the rhythm of arrival repeats rather than being invented twice.
 */
export const LANDMARK = {
  /* Placed on the scene handoffs: the camera passes through the aperture at
     the exact scroll position where Department 01 takes the stage. */
  threshold: 0.2406,
  dept01: 0.3592,
  partition: 0.5567,
  dept02: 0.6465,
  partition02to03: 0.8127,
  dept03: 0.9127,
} as const;

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
function Sign({ at, index, name, note }: { at: number; index: string; name: string; note?: string }) {
  return (
    <div className="cw-prop cw-sign" style={prop(at)}>
      <span className="cw-sign__index">{index}</span>
      <span className="cw-sign__name">{name}</span>
      {note ? <span className="cw-sign__note">{note}</span> : null}
    </div>
  );
}

/**
 * An aperture the camera travels through. Scales past the viewer at the moment
 * it is reached, which is what turns "next section" into "next room".
 */
function Threshold({ at, label }: { at: number; label: string }) {
  return (
    <div className="cw-prop cw-threshold" style={prop(at)}>
      <span className="cw-threshold__frame" />
      <span className="cw-threshold__label">{label}</span>
    </div>
  );
}

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
function Fixture({ at, kind }: { at: number; kind: "research" | "decision" | "writers" }) {
  return (
    <div className="cw-prop cw-fixture" data-kind={kind} style={prop(at)}>
      {Array.from({ length: kind === "research" ? 16 : kind === "decision" ? 8 : 12 }, (_, index) => (
        <span key={index} className="cw-fixture__cell" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * The signal: one object, continuously present, transformed as it is worked on.
 *
 * Its designation changes at each stage of the loop; the object itself never
 * disappears and is never re-created, which is the difference between an idea
 * being *processed* by the studio and a graphic being reused.
 */
function Signal() {
  return (
    <div className="cw-signal" aria-hidden="true">
      <span className="cw-signal__tether" />
      <span className="cw-signal__core" />
      <span className="cw-signal__ring" />
      <span className="cw-signal__evidence">
        {Array.from({ length: 5 }, (_, index) => (
          <i key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </span>
      <span className="cw-signal__labels">
        {SIGNAL.states.map((state) => (
          <span
            key={state.label}
            className="cw-signal__label"
            style={{ "--in": state.from, "--out": state.to } as CSSProperties}
          >
            {state.label}
          </span>
        ))}
      </span>
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
    <div className="cw-world" ref={ref} data-live="false" aria-hidden="true">
      {/* Ambient light. Interpolated rather than switched, so the colour of
          Department 01 has already begun bleeding into the approach corridor. */}
      <div className="cw-world__ambient" />
      <div className="cw-world__beam" />

      {/* Depth planes, slowest first. */}
      <div className="cw-plane cw-plane--far"><HallFar /></div>

      <Fixture at={LANDMARK.dept01} kind="research" />
      <Fixture at={LANDMARK.dept02} kind="decision" />
      <Fixture at={LANDMARK.dept03} kind="writers" />

      <Sign at={LANDMARK.dept01} index={WORLD.dept01.index} name={WORLD.dept01.name} note={WORLD.dept01.note} />
      <Sign at={LANDMARK.dept02} index={WORLD.dept02.index} name={WORLD.dept02.name} note={WORLD.dept02.note} />
      <Sign at={LANDMARK.dept03} index={WORLD.dept03.index} name={WORLD.dept03.name} note={WORLD.dept03.note} />

      <div className="cw-plane cw-plane--mid"><HallMid /></div>

      <div className="cw-world__floor" />
      <ConveyanceLine />
      <Signal />

      <Partition at={LANDMARK.partition} />
      <Partition at={LANDMARK.partition02to03} />
      <div className="cw-plane cw-plane--near"><HallNear /></div>
      <Threshold at={LANDMARK.threshold} label={WORLD.thresholdLabel} />

      {/* Depth haze: the far end of the hall is never fully resolved, which is
          what keeps the building feeling longer than the page. */}
      <div className="cw-world__haze" />
      <div className="cw-world__vignette" />
    </div>
  );
}
