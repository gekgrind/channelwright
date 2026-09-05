"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { driveScenes, tickScenes } from "./scroll-engine";

/**
 * Smooth scrolling for the Channelwright Studios journey.
 *
 * The cinematic run is one long scrubbed sequence, and native wheel scrolling
 * delivers it in coarse, uneven steps: the cues land correctly but the camera
 * stutters. Lenis interpolates the scroll position so the same cue timings are
 * sampled on a continuous curve instead of a staircase.
 *
 * Two constraints shape the integration:
 *
 *  - One frame loop. Lenis already runs a rAF pass to advance its own
 *    animation, so the scene engine is handed that pass (`driveScenes`) rather
 *    than scheduling a second one off scroll events.
 *  - One source of truth. Scenes keep reading `getBoundingClientRect`, which
 *    reflects the smoothed position Lenis has just written, so nothing in the
 *    cue system needs to know smoothing exists.
 *
 * Tuning is deliberately short: the wheel should feel weighted, not delayed.
 */

/** The live instance, so programmatic navigation can route through it. */
let active: Lenis | null = null;

/**
 * Scrolls to an element, through Lenis when it is driving so the move uses the
 * same easing as the rest of the journey. Falls back to the platform behaviour
 * in reduced-motion / static mode.
 */
export function scrollToScene(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  if (active) {
    active.scrollTo(target, { duration: 1.15 });
    return;
  }
  target.scrollIntoView({ behavior: "smooth" });
}

export function useSmoothScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const lenis = new Lenis({
      // Short enough that the page still tracks the wheel; long enough that
      // the deceleration reads as weight rather than as a snap.
      duration: 0.9,
      easing: (t: number) => 1 - (1 - t) ** 3,
      wheelMultiplier: 1,
      // Native momentum on touch is already smooth and syncing it fights the
      // platform; only the wheel is interpolated.
      syncTouch: false,
      touchMultiplier: 1.5,
      // Same easing for in-page anchors (`#register`) as for the journey.
      anchors: { duration: 1.15 },
    });

    active = lenis;
    driveScenes(true);

    // Measure only on frames where the position actually moved. Lenis emits
    // `scroll` synchronously from inside `raf`, so the flag set during the
    // call below is consumed in the same frame it was raised.
    let moved = true;
    lenis.on("scroll", () => {
      moved = true;
    });

    let frame = 0;
    const run = (time: number) => {
      lenis.raf(time);
      if (moved) {
        moved = false;
        tickScenes();
      }
      frame = window.requestAnimationFrame(run);
    };
    frame = window.requestAnimationFrame(run);

    return () => {
      window.cancelAnimationFrame(frame);
      driveScenes(false);
      active = null;
      lenis.destroy();
    };
  }, [enabled]);
}
