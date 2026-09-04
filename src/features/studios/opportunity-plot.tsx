"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";
import { ACID, LUME, easeOut, monoFamily, ramp } from "./instrument";

/**
 * Department 01's instrument, read as a five-beat story rather than an
 * animation. Every visual property is bound to a claim about the work:
 *
 *   NOISE      raw retrieval. Points drift; nothing is ranked yet.
 *   CLUSTER    evidence groups. Points migrate to their cluster centroid.
 *   PRUNE      thin clusters dim out. Rejection is shown, not hidden.
 *   ASSESS     survivors are bracketed and measured against each other.
 *   SELECT     one candidate takes the signal colour and is bound to evidence.
 *
 * Nothing moves outside those beats, so brightness always means confidence and
 * motion always means a claim being resolved. The field is illustrative — the
 * panel says so — and deliberately carries no numbers a buyer could mistake
 * for a forecast.
 */

const MAX_POINTS = 300;

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

type Cluster = {
  x: number;
  y: number;
  spread: number;
  weight: number;
  /** Survives the prune beat. Rejected clusters fade rather than vanish. */
  survives: boolean;
  /** The one opportunity the room commits to. */
  selected?: boolean;
  /** Named only where the room has a candidate to argue about. */
  label?: string;
};

/** x = audience demand, y = competitive saturation (low is better). */
const CLUSTERS: Cluster[] = [
  { x: 0.16, y: 0.68, spread: 0.11, weight: 0.17, survives: false },
  { x: 0.37, y: 0.31, spread: 0.10, weight: 0.16, survives: true, label: "BUDGET BUILDS" },
  { x: 0.52, y: 0.74, spread: 0.09, weight: 0.13, survives: false },
  { x: 0.66, y: 0.46, spread: 0.08, weight: 0.13, survives: true, label: "FIRST-RIG SETUP" },
  { x: 0.79, y: 0.22, spread: 0.062, weight: 0.16, survives: true, selected: true, label: "HONEST COST TESTS" },
  /* Unclustered signal. Evidence does not arrive in tidy blobs. */
  { x: 0.5, y: 0.5, spread: 0.6, weight: 0.25, survives: false },
];

const SELECTED = CLUSTERS.find((cluster) => cluster.selected) ?? CLUSTERS[0];
const SURVIVORS = CLUSTERS.filter((cluster) => cluster.survives);

type Point = {
  /** Where retrieval dropped it. */
  nx: number;
  ny: number;
  /** Where the evidence actually puts it. */
  tx: number;
  ty: number;
  /** Drift amplitude while unresolved. */
  driftX: number;
  driftY: number;
  delay: number;
  size: number;
  cluster: Cluster;
};

function buildField(count: number): Point[] {
  const random = mulberry32(0x5747);
  const points: Point[] = [];

  for (let index = 0; index < count; index += 1) {
    let roll = random();
    let cluster = CLUSTERS[CLUSTERS.length - 1];
    for (const candidate of CLUSTERS) {
      if (roll < candidate.weight) {
        cluster = candidate;
        break;
      }
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
      driftX: (random() - 0.5) * 0.05,
      driftY: (random() - 0.5) * 0.05,
      delay: random() * 0.3,
      size: 0.7 + random() * 1.1,
      cluster,
    });
  }

  return points;
}

export function OpportunityPlot() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = canvas?.closest<HTMLElement>("[data-cw-scene]");
    if (!canvas || !scene) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    // Fewer points on a narrow viewport: the field still reads, at a third of
    // the per-frame work.
    const field = buildField(window.innerWidth < 720 ? Math.round(MAX_POINTS * 0.5) : MAX_POINTS);
    let width = 0;
    let height = 0;
    let progress = 0;
    let painted = -1;
    let mono = "monospace";

    const type = (size: number) => `${size}px ${mono}`;

    const paint = () => {
      if (width === 0 || height === 0) return;
      const inset = { left: 18, right: 18, top: 18, bottom: 28 };
      const plotWidth = width - inset.left - inset.right;
      const plotHeight = height - inset.top - inset.bottom;
      if (plotWidth <= 0 || plotHeight <= 0) return;

      const px = (nx: number) => inset.left + nx * plotWidth;
      const py = (ny: number) => inset.top + ny * plotHeight;

      // The five beats. Overlapping ramps so no beat starts from a standstill.
      const cluster = easeOut(ramp(progress, 0.14, 0.46));
      const prune = ramp(progress, 0.42, 0.6);
      const assess = ramp(progress, 0.55, 0.72);
      const select = ramp(progress, 0.66, 0.86);
      // Residual drift: unresolved evidence is never perfectly still.
      const unrest = 1 - cluster;

      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;

      // A faint measurement grid, so the field reads as a plot being measured
      // rather than a particle effect. It arrives with the cluster beat: there
      // is nothing to measure against while the evidence is still noise.
      if (cluster > 0.02) {
        context.strokeStyle = `rgba(${LUME}, ${0.055 * cluster})`;
        context.beginPath();
        for (let step = 1; step < 4; step++) {
          context.moveTo(px(step / 4), inset.top);
          context.lineTo(px(step / 4), inset.top + plotHeight);
          context.moveTo(inset.left, py(step / 4));
          context.lineTo(inset.left + plotWidth, py(step / 4));
        }
        context.stroke();
      }

      for (const point of field) {
        const local = easeOut(ramp(cluster, point.delay, 1));
        const drift = unrest * (0.5 + point.delay);
        const nx = point.nx + (point.tx - point.nx) * local + point.driftX * drift;
        const ny = point.ny + (point.ty - point.ny) * local + point.driftY * drift;

        const survives = point.cluster.survives;
        const chosen = point.cluster.selected === true;

        // Brightness is confidence. Rejected evidence dims but is still drawn:
        // the room does not pretend the discarded candidates never existed.
        let alpha = 0.16 + local * 0.34;
        if (!survives) alpha *= 1 - prune * 0.78;
        if (survives) alpha += assess * 0.16;
        if (chosen) alpha += select * 0.4;

        context.fillStyle = chosen && select > 0.15 ? `rgba(${ACID}, ${alpha})` : `rgba(${LUME}, ${alpha})`;
        context.beginPath();
        context.arc(px(nx), py(ny), point.size + local * 0.5 + (chosen ? select * 0.7 : 0), 0, Math.PI * 2);
        context.fill();
      }

      // Assess beat: surviving candidates are bracketed so the comparison is
      // visible as a comparison rather than asserted by a caption.
      if (assess > 0) {
        context.lineWidth = 1;
        for (const candidate of SURVIVORS) {
          const chosen = candidate.selected === true;
          const fade = chosen ? assess : assess * (1 - select * 0.72);
          const r = Math.min(plotWidth, plotHeight) * (candidate.spread * 1.5 + 0.05);
          const cx = px(candidate.x);
          const cy = py(candidate.y);
          const arm = r * 0.42;
          context.strokeStyle = `rgba(${LUME}, ${0.3 * fade})`;
          context.beginPath();
          // Corner brackets, not a circle: an instrument marking a region.
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            context.moveTo(cx + sx * r, cy + sy * r - sy * arm);
            context.lineTo(cx + sx * r, cy + sy * r);
            context.lineTo(cx + sx * r - sx * arm, cy + sy * r);
          }
          context.stroke();

          // Named candidates. The assess beat is a comparison between things
          // the room can argue about, not between anonymous blobs.
          if (candidate.label) {
            context.font = type(6.5);
            context.textBaseline = "middle";
            context.textAlign = "center";
            context.fillStyle = `rgba(${chosen && select > 0.15 ? ACID : LUME}, ${(chosen ? 0.7 : 0.4) * fade})`;
            context.textAlign = "left";
          }
        }
      }

      // Select beat: the committed opportunity is ringed, crosshaired, and
      // tied back to the evidence ledger by a single lead line.
      if (select > 0) {
        const cx = px(SELECTED.x);
        const cy = py(SELECTED.y);
        const r = Math.min(plotWidth, plotHeight) * 0.115 * (0.72 + select * 0.28);

        context.strokeStyle = `rgba(${ACID}, ${0.62 * select})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(cx, cy, r, 0, Math.PI * 2);
        context.stroke();

        // Crosshair reaching to the axes: the reading is placed on the scale.
        context.strokeStyle = `rgba(${ACID}, ${0.24 * select})`;
        context.beginPath();
        context.moveTo(inset.left, cy);
        context.lineTo(cx - r, cy);
        context.moveTo(cx, cy + r);
        context.lineTo(cx, inset.top + plotHeight);
        context.stroke();

        // Evidence lead: one line out to the panel edge, where the ledger sits.
        const lead = easeOut(ramp(progress, 0.76, 0.92));
        if (lead > 0) {
          context.strokeStyle = `rgba(${ACID}, ${0.4 * lead})`;
          context.beginPath();
          context.moveTo(cx + r, cy);
          context.lineTo(cx + r + (plotWidth * 0.5) * lead, cy);
          context.stroke();
          context.fillStyle = `rgba(${ACID}, ${0.8 * lead})`;
          context.beginPath();
          context.arc(cx + r + plotWidth * 0.5 * lead, cy, 1.8, 0, Math.PI * 2);
          context.fill();
          // The commitment, stated on the plot: one candidate, bound to the
          // evidence count the ledger beneath the plot reports.
          if (lead > 0.5) {
            context.font = type(7);
            context.textBaseline = "middle";
            context.fillStyle = `rgba(${ACID}, ${(lead - 0.5) * 2})`;
          }
        }
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      mono = monoFamily(canvas);
      painted = -1;
      paint();
    };

    const unregister = registerScene({
      element: scene,
      apply(next, visible) {
        progress = next;
        const quantised = Math.round(next * 400);
        if (!visible || quantised === painted) return;
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
