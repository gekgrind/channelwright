export const TURN_WINDOWS = {
  left: [0.12, 0.68],
  right: [0.26, 0.84],
  full: [0.12, 0.84],
} as const;

export type PoseWeights = { a: number; b: number; c: number };

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Piecewise linear dissolves deliberately expose, rather than conceal, ghosting. */
export function poseWeights(progress: number, window: readonly [number, number]): PoseWeights {
  const local = clamp((progress - window[0]) / (window[1] - window[0]));
  if (local <= 0.5) return { a: 1 - local * 2, b: local * 2, c: 0 };
  return { a: 0, b: 2 - local * 2, c: local * 2 - 1 };
}

/** A sits above B above opaque C. Correct for source-over, not additive opacity. */
export function overlayOpacities({ a, b, c }: PoseWeights) {
  return { a, b: b + c === 0 ? 0 : b / (b + c) };
}
