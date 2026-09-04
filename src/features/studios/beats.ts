/**
 * The edit: the single source of truth for Channelwright Studios' structure.
 *
 * Before this file existed, three separate places carried hand-maintained
 * journey fractions — `LANDMARK` in `./world.tsx`, `SIGNAL.states` in
 * `./copy.ts` and the `--s1..--s8` ramps in `./studios.css` — and every one of
 * them had to be rescaled by hand whenever a department was added. The rescale
 * ratios are still legible in those files' comments (~.8276 for Department 05,
 * ~.7887 for 04). That ritual is the thing this module removes.
 *
 * Here a scene's length is stated once, in viewport-heights, and every journey
 * fraction is *derived* from it. Lengthening a scene, or inserting a beat,
 * changes the denominator and moves every downstream fraction automatically.
 *
 * Two values, deliberately kept apart (see `studios.css`):
 *
 *   --j    timeline. Monotonic 0..1 across the whole run. Drives cue timing,
 *          scene state, facility wake-up, ambient wash and artifact state.
 *   --cam  camera position in the building. Drives spatial travel only, and is
 *          free to run backwards — which is what Beat 8's reverse traversal
 *          will need. Until that beat is staged, `--cam` equals `--j`.
 */

/**
 * Scene lengths in viewport-heights, in scroll order.
 *
 * A scene's stage is sticky and one viewport tall, so a scene of travel `n`
 * yields `n - 1` viewport-heights of scrubbing inside it. The values below are
 * the ones the pass-2 experience shipped with; the nine-beat edit changes them
 * in a later phase.
 */
export const SCENES = [
  { id: "open", travel: 3.4 },
  { id: "intelligence", travel: 4.2 },
  { id: "strategy", travel: 3.6 },
  { id: "writers", travel: 4 },
  { id: "production", travel: 4 },
  { id: "control", travel: 4 },
] as const;

export type SceneId = (typeof SCENES)[number]["id"];

/** Total height of the journey wrapper, in viewport-heights. */
export const TOTAL_TRAVEL = SCENES.reduce((total, scene) => total + scene.travel, 0);

/**
 * Scrollable travel inside the journey wrapper, in viewport-heights.
 *
 * `scroll-engine.ts` measures progress as `-rect.top / (height - viewport)`,
 * so the last viewport of the wrapper is consumed by the final sticky stage
 * and never scrubs. `--j` is therefore a fraction of this, not of the total.
 */
export const SCROLLABLE_TRAVEL = TOTAL_TRAVEL - 1;

/** Viewport-heights before a scene begins. */
const SCENE_START = SCENES.reduce<Record<string, number>>((starts, scene, index) => {
  starts[scene.id] = index === 0 ? 0 : starts[SCENES[index - 1].id] + SCENES[index - 1].travel;
  return starts;
}, {});

const SCENE_TRAVEL = Object.fromEntries(SCENES.map((scene) => [scene.id, scene.travel])) as Record<SceneId, number>;

/** Scroll length of one scene, for `Scene`'s `travel` prop. */
export function sceneTravel(id: SceneId) {
  return SCENE_TRAVEL[id];
}

/**
 * A position inside a scene, expressed as a fraction of the whole journey.
 *
 * `at` is a fraction of that scene's own travel, so a landmark stays with its
 * room when the run around it changes length. Rounded to four decimals: `--j`
 * is quantised to three by the scroll engine, so further precision could not
 * reach the screen.
 */
export function journeyAt(scene: SceneId, at: number) {
  return Number(((SCENE_START[scene] + at * SCENE_TRAVEL[scene]) / SCROLLABLE_TRAVEL).toFixed(4));
}

/**
 * Fixed props in the building, placed relative to the room they belong to.
 *
 * The `at` fractions are seeded from the positions the pass-2 experience
 * shipped with, so introducing this module moves nothing on screen. They are
 * irregular for that reason alone — a department's signage sits somewhere
 * around 43–51% into its room and a partition somewhere around 7–14% into the
 * room it opens — and a later phase is free to regularise them deliberately.
 */
export const LANDMARK = {
  /* The camera passes through the aperture just as Department 01 takes the stage. */
  threshold: journeyAt("intelligence", 0.020862),
  dept01: journeyAt("intelligence", 0.430505),
  partition: journeyAt("strategy", 0.130472),
  dept02: journeyAt("strategy", 0.491222),
  partition02to03: journeyAt("writers", 0.144275),
  dept03: journeyAt("writers", 0.506135),
  partition03to04: journeyAt("production", 0.115525),
  dept04: journeyAt("production", 0.47794),
  partition04to05: journeyAt("control", 0.07179),
  dept05: journeyAt("control", 0.434205),
} as const;
