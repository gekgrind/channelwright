"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef } from "react";
import { Cue, Scene } from "./scene";
import { registerScene } from "./scroll-engine";
import { FOOTER, OPEN } from "./copy";

/**
 * The audience — the last act of Channelwright Studios, and its footer.
 *
 * The visitor has spent the page watching how media gets made. Here they
 * arrive in front of the people it is made for: an old cinema audience in
 * cardboard 3D glasses, absorbed in a film we never see. As the page scrolls,
 * attention comes off the screen and onto the visitor, and by the end the room
 * is quietly looking back. Then, over that same held frame, the site says its
 * last line and offers its one action. There is no footer *after* the
 * audience: the audience is the footer.
 *
 * ## Why full-frame cuts, and why they are timed rather than scrubbed
 *
 * The four plates in `public/footer/` are separate generations of the same
 * staged audience. Plate 2 is pixel-registered to plate 1 (mean |Δ| ≈ 6/255,
 * noise), but plates 3 and 4 drift *everywhere*: measured at 720p, 2→3 and
 * 3→4 differ by a mean of 21–26/255 with a 90th percentile above 65, and no
 * column or row of either pair falls below ~10. There is therefore no region
 * of this artwork where two plates can be blended, masked or seamed — every
 * pixel held at partial alpha, in any mask of any softness, is a permanent
 * double exposure, and every previous build of this footer (crossfades, dip
 * to shadow, blur-and-swap under person-sized masks) failed on exactly that:
 * doubled glasses inside the feather, or a blurred patch the eye read as a
 * patch.
 *
 * So no pixel is ever a blend of two plates. Each change is a **full-frame
 * cut hidden inside a dip of the projector's light**: the room goes dark for
 * a few frames, the plate underneath is swapped while it is dark, and the
 * light comes back on people who have turned. A flicker in the only light
 * source in the room is the one thing a cinema actually does, and the dark
 * gap is what makes the per-person drift invisible — change blindness across
 * a blank is near total, and nothing on screen ever moves *while* visible.
 * The first cut, 1→2, is registered, so it gets only a flutter: two men come
 * off the screen under a light that barely wavers, which is the right amount
 * of doubt for a first notice.
 *
 * The cuts are triggered by scroll but *timed by the clock*. A scrubbed dip
 * would let a visitor park on a black frame, and a fast scroll could skip
 * from one plate to the next with the dip never painted. Instead the engine
 * writes a crossing (like `Scene`'s `revealAt`), the dip runs as a ~400ms
 * compositor animation, and the plate swaps at its darkest point. Scrolling
 * back crosses back, with the same dip. Nothing here runs per frame in
 * JavaScript beyond the one comparison the shared engine already pays for.
 */

type Beat = {
  id: string;
  /** Plate shown once this beat has happened. */
  plate: 2 | 3 | 4;
  /** Scene progress at which it happens. */
  at: number;
  /** How the light behaves over the cut. */
  cover: "flutter" | "dark";
  note: string;
};

/**
 * Three beats, ordered by how far the change has to travel.
 *
 * The holds between them are as much of the effect as the changes: they let
 * a visitor stop scrolling and find a coherent photograph rather than a
 * half-finished blend.
 */
export const BEATS: readonly Beat[] = [
  {
    id: "notice",
    plate: 2,
    at: 0.16,
    cover: "flutter",
    note: "First notice. The curly man in the middle row turns to three-quarter and the man beside him lowers his chin. Registered plates, so the light only flutters — easy to miss, which is the point.",
  },
  {
    id: "row",
    plate: 3,
    at: 0.38,
    cover: "dark",
    note: "The row. The light dips and comes back on the whole sharp middle row and two of the rear row looking straight down the lens. Attention has spread through the room.",
  },
  {
    id: "room",
    plate: 4,
    at: 0.58,
    cover: "dark",
    note: "The room. The rear blonde and the three out-of-focus heads nearest the visitor turn last — the people closest to us are the last to look up. Two mid-left viewers never do, in any plate, and stay with the film.",
  },
];

/** Scene progress over which the closing copy resolves over the held frame. */
export const CLOSE = { from: 0.8, to: 0.9 } as const;

/**
 * The light over each cut, as compositor keyframes for the dark overlay.
 *
 * `swapAt` is the moment (ms from the start) at which the plate underneath
 * changes — the darkest frame of the dip. The dark cover sits at .97 rather
 * than 1 because a literal black frame reads as the page failing; a trace of
 * the room under it reads as the projector lamp.
 */
export const COVER = {
  flutter: {
    duration: 380,
    swapAt: 110,
    frames: [
      { opacity: 0, offset: 0 },
      { opacity: 0.44, offset: 0.28, easing: "ease-out" },
      { opacity: 0.12, offset: 0.5 },
      { opacity: 0.3, offset: 0.66 },
      { opacity: 0, offset: 1 },
    ],
  },
  dark: {
    duration: 560,
    swapAt: 200,
    frames: [
      { opacity: 0, offset: 0, easing: "ease-in" },
      { opacity: 0.97, offset: 0.3 },
      { opacity: 0.97, offset: 0.42, easing: "ease-out" },
      { opacity: 0, offset: 1 },
    ],
  },
} as const;

/** How many beats have happened at a given scene progress: 0..BEATS.length. */
export function beatAt(progress: number) {
  let count = 0;
  for (const beat of BEATS) if (progress >= beat.at) count += 1;
  return count;
}

/**
 * Crossing detection and the cut itself.
 *
 * One more subscriber in the shared engine's pass. It compares the beat the
 * scroll position calls for against the one painted, and when they differ
 * runs a cut: the cover animates, and at its darkest frame `data-beat` is
 * written, which is the only thing CSS reads. A cut already in flight is
 * never interrupted — a fast scroll across all three beats is one dip landing
 * on the final plate, not three — and a further crossing during a cut is
 * picked up when it ends.
 */
function useAudienceCuts(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    const element = document.getElementById("audience");
    const cover = root?.querySelector<HTMLElement>(".cw-aud__cover");
    if (!root || !element || !cover) return;

    let shown = -1;
    let wanted = 0;
    let inFlight = false;
    let swapTimer = 0;
    let animation: Animation | null = null;

    const paint = (beat: number) => {
      shown = beat;
      root.dataset.beat = String(beat);
    };

    const cut = () => {
      if (inFlight || wanted === shown) return;
      inFlight = true;
      // The cover of the beat being crossed *into* going forward, or *out of*
      // going back — either way the change of light belongs to that beat.
      const index = Math.max(wanted, shown) - 1;
      const kind = BEATS[index]?.cover ?? "dark";
      const spec = COVER[kind];
      if (typeof cover.animate !== "function") {
        paint(wanted);
        inFlight = false;
        return;
      }
      animation = cover.animate(spec.frames.map((frame) => ({ ...frame })), { duration: spec.duration, fill: "none" });
      swapTimer = window.setTimeout(() => {
        swapTimer = 0;
        paint(wanted);
      }, spec.swapAt);
      animation.onfinish = () => {
        inFlight = false;
        animation = null;
        // Painted at the dark frame even if `wanted` moved on; catch up now.
        if (wanted !== shown) cut();
      };
    };

    const stop = registerScene({
      element,
      apply(progress) {
        wanted = beatAt(progress);
        if (shown === -1) {
          // First measure: land on the right plate without a dip. A visitor
          // arriving mid-scene (reload, anchor) meets the room as it is.
          paint(wanted);
          return;
        }
        if (wanted !== shown) cut();
      },
    });

    return () => {
      stop();
      window.clearTimeout(swapTimer);
      animation?.cancel();
    };
  }, [rootRef]);
}

/**
 * The closing copy, over the held frame. Shared by both modes so the reduced-
 * motion page ends on exactly the same words and the same action.
 *
 * A `<footer>` with an explicit `contentinfo` role: the cinematic path mounts
 * it inside `<main>`, where a bare `<footer>` would carry no landmark role,
 * and the site's last action and note should stay reachable by landmark
 * navigation exactly as the standalone footer they replace was.
 */
function Close({ children }: { children?: ReactNode }) {
  return (
    <footer className="cw-aud__close" role="contentinfo" aria-label="Channelwright Studios">
      <div className="cw-shell cw-aud__close-grid">
        <div className="cw-aud__close-main">
          <p className="cw-mono cw-mono--signal">Channelwright Studios</p>
          <p className="cw-aud__line">{FOOTER.line}</p>
          <Link className="cw-cta cw-cta--solid cw-aud__cta" href="/login">
            {OPEN.primaryCta}
          </Link>
        </div>
        <p className="cw-aud__note">{FOOTER.note}</p>
      </div>
      {children}
    </footer>
  );
}

export function AudienceFooter() {
  const rootRef = useRef<HTMLDivElement>(null);
  useAudienceCuts(rootRef);

  return (
    <Scene
      id="audience"
      travel={6.5}
      label="The audience"
      className="cw-scene--audience"
      revealAt={CLOSE.from}
    >
      {/* Server-rendered on the settled plate, so a visitor whose engine has
          not started yet (or has no JavaScript) meets the room already
          looking at them rather than an empty stage. The first measure
          corrects it without a cut. */}
      <div className="cw-aud" aria-hidden="true" ref={rootRef} data-beat="3">
        <div className="cw-aud__frame">
          <div className="cw-aud__plate" data-plate="1" />
          <div className="cw-aud__plate" data-plate="2" />
          <div className="cw-aud__plate" data-plate="3" />
          <div className="cw-aud__plate" data-plate="4" />
          <div className="cw-aud__grade" />
        </div>
        {/* The projector's light. Inert at rest; animated by the cut. */}
        <div className="cw-aud__cover" />
      </div>
      {/* Resolves only once the room has been looking back for a while: the
          visitor gets the moment before they get the message. */}
      <Cue from={CLOSE.from} to={CLOSE.to} className="cw-aud__close-cue">
        <Close />
      </Cue>
    </Scene>
  );
}

/**
 * The reduced-motion audience.
 *
 * Not the animation stopped part-way, and not the artwork withheld: the plate
 * the sequence was travelling towards, held still, with the same closing copy
 * over it. Someone who has asked for less motion still gets the photograph,
 * the glasses, the stare and the last line.
 */
export function AudienceFooterStatic() {
  return (
    <div className="cw-aud cw-aud--static" data-beat="3">
      <div className="cw-aud__frame" aria-hidden="true">
        <div className="cw-aud__plate" data-plate="4" />
        <div className="cw-aud__grade" />
      </div>
      <Close />
    </div>
  );
}
