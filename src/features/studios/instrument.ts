"use client";

/**
 * Shared vocabulary for the department instruments.
 *
 * Every instrument is a scrubbed 2D canvas telling one department's operation
 * as a short sequence of beats. They agree on their ramps, their easing, their
 * status colours and their type, so five different diagrams still read as five
 * gauges from the same facility rather than five separate widgets.
 */

/** Status colours. Colour means state in every room: never decoration. */
export const LUME = "242, 239, 230";
export const ACID = "216, 255, 62";
export const WARN = "255, 104, 70";

export function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Normalises `value` across a beat's window. */
export function ramp(value: number, from: number, to: number) {
  return clamp01((value - from) / (to - from));
}

export function easeOut(value: number) {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

/**
 * Canvas cannot resolve `var(--font-mono)` inside its `font` shorthand — the
 * declaration is simply dropped and every label falls back to 10px sans-serif,
 * which is why instrument type has never matched the panel type around it.
 * Resolving the custom property against the element once, at resize, gives the
 * instruments the same monospace as their chrome.
 */
export function monoFamily(element: Element) {
  const resolved = getComputedStyle(element).getPropertyValue("--font-mono").trim();
  return resolved ? `${resolved}, monospace` : "monospace";
}

/** Truncates to fit `max` pixels, ending in a middle dot rather than an ellipsis. */
export function fit(context: CanvasRenderingContext2D, text: string, max: number) {
  if (context.measureText(text).width <= max) return text;
  let cut = text.length;
  while (cut > 1 && context.measureText(`${text.slice(0, cut)}·`).width > max) cut--;
  return `${text.slice(0, cut).trimEnd()}·`;
}
