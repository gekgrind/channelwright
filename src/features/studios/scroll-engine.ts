"use client";

/**
 * Shared scroll driver for the Channelwright Studios experience.
 *
 * One passive scroll listener and one rAF pass service every scene on the page,
 * so adding departments costs a rect read rather than another listener. Scenes
 * receive a 0..1 progress value describing how far the viewer has travelled
 * through that scene's own scroll range; all visual work is then done in CSS
 * from a single custom property. Nothing here writes layout-affecting styles.
 */

export type SceneTarget = {
  element: HTMLElement;
  /** Called with progress 0..1 and whether the stage is on screen. */
  apply: (progress: number, onStage: boolean) => void;
};

const targets = new Set<SceneTarget>();
let frameHandle = 0;
let listening = false;
/** True while a smooth-scroll driver owns the frame loop (see ./smooth-scroll). */
let driven = false;

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function measure() {
  frameHandle = 0;
  const viewport = window.innerHeight;

  for (const target of targets) {
    const rect = target.element.getBoundingClientRect();
    // Travel available inside the scene once the sticky stage is pinned.
    const travel = rect.height - viewport;
    const progress = travel <= 0 ? (rect.top <= 0 ? 1 : 0) : clamp01(-rect.top / travel);
    const onStage = rect.top < viewport && rect.bottom > 0;
    target.apply(progress, onStage);
  }
}

function schedule() {
  if (frameHandle !== 0) return;
  frameHandle = window.requestAnimationFrame(measure);
}

/** Scroll events are ignored while a driver is measuring once per its own
 *  frame; without this the page would run two rAF passes for one gesture. */
function onScroll() {
  if (driven) return;
  schedule();
}

function startListening() {
  if (listening) return;
  listening = true;
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
}

function stopListening() {
  if (!listening) return;
  listening = false;
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", schedule);
  window.removeEventListener("orientationchange", schedule);
  if (frameHandle !== 0) {
    window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
}

export function registerScene(target: SceneTarget) {
  targets.add(target);
  startListening();
  schedule();
  return () => {
    targets.delete(target);
    if (targets.size === 0) stopListening();
  };
}

/** Requests a recalculation, e.g. after fonts settle or content height changes. */
export function refreshScenes() {
  schedule();
}

/**
 * Hands frame control to a smooth-scroll driver, or takes it back.
 *
 * While driven, the engine stops scheduling its own rAF off scroll events and
 * measures from inside the driver's pass instead, so a smoothed scroll still
 * costs exactly one loop and scene progress is always read from the position
 * that was actually painted this frame rather than the one before it.
 */
export function driveScenes(active: boolean) {
  driven = active;
  if (active && frameHandle !== 0) {
    window.cancelAnimationFrame(frameHandle);
    frameHandle = 0;
  }
  if (!active) schedule();
}

/** Measures now. Called by the driver from inside its own rAF pass. */
export function tickScenes() {
  if (frameHandle !== 0) window.cancelAnimationFrame(frameHandle);
  measure();
}
