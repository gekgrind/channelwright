"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { registerScene } from "./scroll-engine";

/**
 * Scene primitives shared by every department of Channelwright Studios.
 *
 * A `Scene` is a tall scroll block containing one sticky `Stage`. The engine
 * writes `--p` (0..1) onto the scene element; layers inside read it through
 * `Cue`, which maps a slice of that range onto `--t` (linear) and `--te`
 * (ease-out). Departments therefore compose out of the same vocabulary rather
 * than each inventing its own scroll wiring.
 */

type SceneProps = {
  id: string;
  /** Scroll length of the scene, in viewport heights. Minimum 1. */
  travel?: number;
  className?: string;
  children: ReactNode;
  /** Announced by the department rail while this scene holds the stage. */
  label?: string;
};

export function Scene({ id, travel = 3, className, children, label }: SceneProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let last = -1;
    let lastOnStage: boolean | null = null;

    return registerScene({
      element,
      apply(progress, onStage) {
        // Quantise to avoid style writes that cannot be perceived.
        const value = Math.round(progress * 1000) / 1000;
        if (value !== last) {
          last = value;
          element.style.setProperty("--p", String(value));
        }
        if (onStage !== lastOnStage) {
          lastOnStage = onStage;
          element.dataset.onStage = onStage ? "true" : "false";
        }
      },
    });
  }, []);

  return (
    <section
      ref={ref}
      id={id}
      aria-label={label}
      data-cw-scene=""
      data-on-stage="false"
      className={className}
      style={{ "--travel": travel } as CSSProperties}
    >
      <div className="cw-stage">{children}</div>
    </section>
  );
}

type CueProps = {
  /** Scene progress at which this cue starts, 0..1. */
  from: number;
  /** Scene progress at which this cue completes, 0..1. */
  to: number;
  as?: "div" | "span" | "p" | "li" | "figure" | "header";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * Maps [from, to] of the parent scene onto `--t` / `--te` for its subtree.
 * Layers style themselves from those values; no JS runs per frame.
 */
export function Cue({ from, to, as = "div", className, style, children }: CueProps) {
  const Tag = as;
  return (
    <Tag
      className={["cw-cue", className].filter(Boolean).join(" ")}
      style={{ "--in": from, "--out": to, ...style } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/**
 * Media-query state read through `useSyncExternalStore`, so the value is
 * correct on the first client render rather than after a settling pass.
 * The server snapshot is always `false`: the cinematic path is the default,
 * and a matching client narrows it immediately on hydration.
 */
function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * True once the visitor has expressed a preference for reduced motion.
 * Scenes stay legible and fully readable in that mode; only travel is removed.
 */
export function useReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * True when canvas-backed layers should be replaced by a static equivalent.
 * The scrubbed 2D field is inexpensive on phones once its point count scales
 * down, so only an explicit reduced-motion preference forces the fallback.
 */
export function useLightweightMode() {
  return useReducedMotion();
}
