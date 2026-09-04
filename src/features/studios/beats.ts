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
 * yields `n - 1` viewport-heights of scrubbing inside it.
 *
 * The cold open carries two beats rather than one — the idea (Beat 1) and the
 * threshold into the Studios (Beat 2) — and Beat 2 is the widest shot in the
 * run, so it is given room to open rather than being crossed on the way to
 * Department 01. Every other scene is unchanged; because every journey
 * fraction below is derived, lengthening this one moves the whole building
 * later without moving anything inside a room.
 */
export const SCENES = [
  { id: "open", travel: 4.6 },
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
  /* Beat 2. The crossing is the climax of the cold open, not a prop passed on
     the way out of it: the camera reaches the aperture near the end of the
     open scene and the approach corridor beyond it runs into Department 01. */
  threshold: journeyAt("open", 0.88),
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

/* --------------------------------------------------------------- lighting */

/**
 * A window on the journey, as `[from, to]` fractions.
 *
 * The stylesheet used to carry these as bare decimals — `.012`, `.14`, `.22`,
 * `.64` — which is the same hand-maintained-fraction problem this module was
 * written to remove, one file over: lengthening a scene silently slid every
 * light cue relative to the room it belongs to. They are stated here in
 * room-relative terms and handed to CSS by `world.tsx`.
 */
type Window = readonly [number, number];

/**
 * The facility's light, staged by depth rather than switched on at once.
 *
 * Beat 1 is deliberately restrained: only the surfaces the visitor is standing
 * between — ceiling, deck, jambs, the rig overhead — are perceptible, and they
 * sit on a floor (`WAKE_FLOOR`) so the frame reads as a dark building rather
 * than an unfinished page. Beat 2 then brings the operating floor up, and the
 * back wall last, so the reveal builds foreground → middle → distance and the
 * hall is understood as deep before it is understood as bright.
 *
 * Every ramp completes by the approach corridor into Department 01, so Beats
 * 3–7 are lit exactly as they were before this phase.
 */
export const LIGHT = {
  /** Near shell: ceiling, deck, jambs, the rig, the ambient wash. */
  wake: [journeyAt("open", 0.06), journeyAt("open", 0.56)] as Window,
  /** The operating floor, one step further in. */
  wakeMid: [journeyAt("open", 0.34), journeyAt("open", 0.74)] as Window,
  /** The back wall, last — the hall is longest at the moment it resolves. */
  wakeFar: [journeyAt("open", 0.5), journeyAt("open", 0.86)] as Window,
  /** Beat 2 itself: the window in which the threshold resolves out of the
   *  dark at the far end of the hall and begins its approach. */
  reveal: [journeyAt("open", 0.34), journeyAt("open", 0.6)] as Window,
  /** The cold open's key light, which the hall's own light replaces. */
  beam: [journeyAt("open", 0.3), journeyAt("open", 0.62)] as Window,
  /** Department 01's wash, and the building's warmer second half. Both are
   *  carried over unchanged from the pass-2 timings, restated room-relative. */
  dept01: [journeyAt("intelligence", 0.3533), journeyAt("strategy", 0.2322)] as Window,
  dept02: [journeyAt("writers", 0.752), journeyAt("production", 0.751)] as Window,
} as const;

/** Floors, so nothing in the opening frame is at absolute nothing. */
export const WAKE_FLOOR = { near: 0.22, mid: 0.05, far: 0 } as const;

/**
 * Gates for things that only exist inside the building.
 *
 * `inside` is the signage/fixture gate; `route` is the conveyance line, which
 * lights during the reveal because it is what the artifact is about to be set
 * down on. Both end where they used to, so Department 01 is unchanged.
 */
export const GATE = {
  inside: [journeyAt("open", 0.86), journeyAt("intelligence", 0.625)] as Window,
  fixtures: [journeyAt("open", 0.914), journeyAt("intelligence", 0.261)] as Window,
  route: [journeyAt("open", 0.56), journeyAt("intelligence", 0.935)] as Window,
  /** The crossing dolly: rises to the threshold, relaxes inside the corridor. */
  dolly: [journeyAt("open", 0.6), LANDMARK.threshold, journeyAt("intelligence", 0.1)] as const,
} as const;

/**
 * The journey constants as CSS custom properties, for the world layer.
 *
 * Emitted rather than written into the stylesheet so a scene length can only
 * ever be changed in one place. Values are plain numbers; the ramps that
 * consume them live in `studios.css`.
 */
export function lightVariables(): Record<string, string> {
  const pairs: Record<string, Window> = {
    wake: LIGHT.wake,
    "wake-mid": LIGHT.wakeMid,
    "wake-far": LIGHT.wakeFar,
    reveal: LIGHT.reveal,
    beam: LIGHT.beam,
    l1: LIGHT.dept01,
    l2: LIGHT.dept02,
    inside: GATE.inside,
    fixtures: GATE.fixtures,
    route: GATE.route,
  };

  /* Each window is emitted as a start and a *reciprocal span*, never as two
     endpoints the stylesheet then divides: `calc()` division by anything but a
     literal number is the kind of thing that silently invalidates a whole
     declaration, and a dropped ramp here would take the building's light with
     it. Multiplication by a precomputed `1 / (to - from)` cannot. */
  const rate = (from: number, to: number) => Number((1 / (to - from)).toFixed(4));

  const vars: Record<string, string> = {
    "--wake-floor": String(WAKE_FLOOR.near),
    "--wake-mid-floor": String(WAKE_FLOOR.mid),
    "--wake-far-floor": String(WAKE_FLOOR.far),
    "--dolly-a": String(GATE.dolly[0]),
    "--dolly-in": String(rate(GATE.dolly[0], GATE.dolly[1])),
    "--dolly-b": String(GATE.dolly[1]),
    "--dolly-out": String(rate(GATE.dolly[1], GATE.dolly[2])),
  };
  for (const [name, [from, to]] of Object.entries(pairs)) {
    vars[`--${name}-a`] = String(from);
    vars[`--${name}-k`] = String(rate(from, to));
  }
  return vars;
}
