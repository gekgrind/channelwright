"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";

/**
 * The Intelligence Room's instrument: a field of raw signal resolving into
 * ranked opportunity clusters as the visitor scrolls.
 *
 * Canvas is used here rather than DOM because the scene needs a few hundred
 * points moving independently — the one place in the opening where CSS would
 * be the heavier option. It is scrubbed by scroll progress rather than time,
 * so it costs nothing when the visitor is still, and it is never mounted on
 * constrained devices or under prefers-reduced-motion (a static field is
 * rendered instead).
 */

const MAX_POINTS = 280;

/** Deterministic RNG so the field is identical on every load and every device. */
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clusters in normalised plot space: x = audience demand, y = competitive saturation. */
const CLUSTERS = [
  { x: 0.17, y: 0.24, spread: 0.13, weight: 0.22, opportunity: false },
  { x: 0.41, y: 0.57, spread: 0.12, weight: 0.19, opportunity: false },
  { x: 0.58, y: 0.26, spread: 0.10, weight: 0.14, opportunity: false },
  { x: 0.81, y: 0.73, spread: 0.07, weight: 0.26, opportunity: true },
  /* Unclustered signal. Evidence does not arrive in four tidy blobs. */
  { x: 0.5, y: 0.5, spread: 0.62, weight: 0.19, opportunity: false },
];

type Point = { nx: number; ny: number; tx: number; ty: number; delay: number; size: number; opportunity: boolean };

function buildField(count: number): Point[] {
  const random = mulberry32(0x5747);
  const points: Point[] = [];

  for (let index = 0; index < count; index += 1) {
    let roll = random();
    let cluster = CLUSTERS[CLUSTERS.length - 1];
    for (const candidate of CLUSTERS) {
      if (roll < candidate.weight) { cluster = candidate; break; }
      roll -= candidate.weight;
    }

    // Box-Muller keeps clusters round rather than square.
    const radius = Math.sqrt(-2 * Math.log(1 - random())) * cluster.spread * 0.5;
    const angle = random() * Math.PI * 2;

    points.push({
      nx: random(),
      ny: random(),
      tx: Math.min(0.97, Math.max(0.03, cluster.x + Math.cos(angle) * radius)),
      ty: Math.min(0.97, Math.max(0.03, cluster.y + Math.sin(angle) * radius)),
      delay: random() * 0.34,
      size: 0.7 + random() * 1.1,
      opportunity: cluster.opportunity,
    });
  }

  return points;
}

function easeOut(value: number) {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return 1 - (1 - clamped) ** 3;
}

export function OpportunityPlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = canvas?.closest<HTMLElement>("[data-cw-scene]");
    if (!canvas || !scene) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    // Fewer points on a narrow viewport: the field still reads, at a third
    // of the per-frame work.
    const field = buildField(window.innerWidth < 720 ? Math.round(MAX_POINTS * 0.55) : MAX_POINTS);
    let width = 0;
    let height = 0;
    let progress = 0;
    let onStage = false;
    let painted = -1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      painted = -1;
      paint();
    };

    const paint = () => {
      if (width === 0 || height === 0) return;
      const inset = { left: 16, right: 16, top: 16, bottom: 26 };
      const plotWidth = width - inset.left - inset.right;
      const plotHeight = height - inset.top - inset.bottom;
      if (plotWidth <= 0 || plotHeight <= 0) return;

      context.clearRect(0, 0, width, height);

      // Resolution ramps across the middle of the scene.
      const resolve = easeOut((progress - 0.1) / 0.46);

      for (const point of field) {
        const local = easeOut((resolve - point.delay) / (1 - point.delay || 1));
        const x = inset.left + (point.nx + (point.tx - point.nx) * local) * plotWidth;
        const y = inset.top + (point.ny + (point.ty - point.ny) * local) * plotHeight;

        const highlight = point.opportunity ? local : 0;
        const alpha = 0.2 + local * 0.42 + highlight * 0.34;
        context.fillStyle = point.opportunity && local > 0.35
          ? `rgba(216, 255, 62, ${alpha})`
          : `rgba(242, 239, 230, ${alpha})`;
        context.beginPath();
        context.arc(x, y, point.size + local * 0.55, 0, Math.PI * 2);
        context.fill();
      }

      // The read-out: the opportunity cluster is ringed once the field settles.
      const ring = easeOut((progress - 0.58) / 0.2);
      if (ring > 0) {
        const cluster = CLUSTERS.find((entry) => entry.opportunity) ?? CLUSTERS[0];
        const cx = inset.left + cluster.x * plotWidth;
        const cy = inset.top + cluster.y * plotHeight;
        const radius = Math.min(plotWidth, plotHeight) * 0.13;
        context.strokeStyle = `rgba(216, 255, 62, ${0.5 * ring})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(cx, cy, radius * (0.7 + ring * 0.3), 0, Math.PI * 2);
        context.stroke();

        context.strokeStyle = `rgba(216, 255, 62, ${0.24 * ring})`;
        context.beginPath();
        context.moveTo(cx + radius, cy);
        context.lineTo(inset.left + plotWidth, cy);
        context.stroke();
      }
    };

    const unregister = registerScene({
      element: scene,
      apply(next, visible) {
        progress = next;
        onStage = visible;
        const quantised = Math.round(next * 400);
        if (!onStage || quantised === painted) return;
        painted = quantised;
        paint();
      },
    });

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      unregister();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
