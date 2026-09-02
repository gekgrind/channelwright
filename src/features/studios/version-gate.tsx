"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";

/**
 * Department 02's instrument. Where the Opportunity Plot resolves noise into
 * one selected candidate, the Version Gate resolves *candidate strategies*
 * into one approved, versioned decision — and then demonstrates the gate
 * that decision buys: a stale version's signal cannot start production.
 *
 *   FILE       three strategy versions are drafted, unranked.
 *   COMPARE    each is measured against the others on a shared scale.
 *   SUPERSEDE  the weaker two are struck through and retired to the record
 *              (not deleted — Department 02's whole claim is that nothing
 *              is silently thrown away).
 *   APPROVE    the surviving version is bound to a version number.
 *   GATE       the approved signal passes the gate into production; a
 *              superseded signal reaches the same gate and is blocked.
 *
 * Colour again means status rather than decoration: lume is unresolved or
 * retired, acid is the one version production is allowed to run against.
 */

const LUME = "242, 239, 230";
const ACID = "216, 255, 62";
const WARN = "255, 104, 70";

type Version = {
  label: string;
  /** Illustrative fit score, 0..1 — the basis for the ranking, not a claim. */
  score: number;
  approved?: boolean;
};

const VERSIONS: Version[] = [
  { label: "v1 · Beginner tutorials", score: 0.41 },
  { label: "v2 · Niche deep-dives", score: 0.58 },
  { label: "v3 · Comparison series", score: 0.83, approved: true },
];

const APPROVED = VERSIONS.find((version) => version.approved) ?? VERSIONS[0];

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function ramp(value: number, from: number, to: number) {
  return clamp01((value - from) / (to - from));
}

function easeOut(value: number) {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

export function VersionGate() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const scene = canvas?.closest<HTMLElement>("[data-cw-scene]");
    if (!canvas || !scene) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let width = 0;
    let height = 0;
    let progress = 0;
    let painted = -1;

    const paint = () => {
      if (width === 0 || height === 0) return;
      const inset = { left: 18, right: 66, top: 22, bottom: 20 };
      const rowGap = (height - inset.top - inset.bottom) / VERSIONS.length;
      const trackLeft = inset.left;
      const trackRight = width - inset.right;
      const trackWidth = trackRight - trackLeft;
      const gateX = trackLeft + trackWidth * 0.74;

      // The five beats. Overlapping ramps so nothing starts from a standstill.
      const file = easeOut(ramp(progress, 0.04, 0.32));
      const compare = ramp(progress, 0.26, 0.44);
      const supersede = ramp(progress, 0.4, 0.58);
      const approve = ramp(progress, 0.5, 0.64);
      const pass = easeOut(ramp(progress, 0.6, 0.86));
      const block = easeOut(ramp(progress, 0.66, 0.9));

      context.clearRect(0, 0, width, height);

      // Gate: a break in a vertical bracket that only the approved beat opens.
      const gateOpen = clamp01(approve * 1.2);
      context.strokeStyle = `rgba(${LUME}, .3)`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(gateX, inset.top - 6);
      context.lineTo(gateX, inset.top - 6 + (height - inset.top - inset.bottom) * (0.5 - gateOpen * 0.5));
      context.moveTo(gateX, inset.top - 6 + (height - inset.top - inset.bottom) * (0.5 + gateOpen * 0.5));
      context.lineTo(gateX, height - inset.bottom + 6);
      context.stroke();

      VERSIONS.forEach((version, index) => {
        const y = inset.top + rowGap * (index + 0.5);
        const targetWidth = trackWidth * 0.55 * version.score;
        const barWidth = targetWidth * file;

        // Supersede: retired rows sink slightly and drift toward the archive
        // edge rather than vanishing — the record keeps them.
        const retire = version.approved ? 0 : supersede;
        const rowY = y + retire * 10;
        const rowAlpha = version.approved ? 1 : 1 - retire * 0.62;
        const tone = version.approved && approve > 0.1 ? ACID : LUME;

        context.globalAlpha = 0.18 + file * 0.5 * rowAlpha;
        context.fillStyle = `rgba(${tone}, 1)`;
        context.fillRect(trackLeft, rowY - 3, barWidth, 6);
        context.globalAlpha = 1;

        // Compare: a faint tick at each score once ranking is visible.
        if (compare > 0 && !version.approved) {
          context.strokeStyle = `rgba(${LUME}, ${0.35 * compare * (1 - supersede * 0.6)})`;
          context.beginPath();
          context.moveTo(trackLeft + targetWidth, rowY - 6);
          context.lineTo(trackLeft + targetWidth, rowY + 6);
          context.stroke();
        }

        // Strike-through on the two versions the room does not run production
        // against — shown, not erased.
        if (!version.approved && supersede > 0.05) {
          context.strokeStyle = `rgba(${LUME}, ${0.5 * supersede})`;
          context.beginPath();
          context.moveTo(trackLeft, rowY);
          context.lineTo(trackLeft + Math.max(barWidth, targetWidth), rowY);
          context.stroke();
        }

        // Approve: the surviving version gets a version stamp at its tip.
        if (version.approved && approve > 0.1) {
          context.fillStyle = `rgba(${ACID}, ${0.85 * approve})`;
          context.beginPath();
          context.arc(trackLeft + barWidth, rowY, 3, 0, Math.PI * 2);
          context.fill();
        }
      });

      // Pass beat: the approved signal travels from its bar through the open
      // gate to a production node at the right edge.
      const approvedY = inset.top + rowGap * (VERSIONS.indexOf(APPROVED) + 0.5);
      const approvedStart = trackLeft + trackWidth * 0.55 * APPROVED.score;
      if (pass > 0) {
        const px = approvedStart + (trackRight - approvedStart) * pass;
        context.strokeStyle = `rgba(${ACID}, ${0.5 * pass})`;
        context.beginPath();
        context.moveTo(approvedStart, approvedY);
        context.lineTo(Math.min(px, trackRight), approvedY);
        context.stroke();
        context.fillStyle = `rgba(${ACID}, ${0.9 * pass})`;
        context.beginPath();
        context.arc(Math.min(px, trackRight), approvedY, 2.6, 0, Math.PI * 2);
        context.fill();
      }
      if (pass > 0.85) {
        context.fillStyle = `rgba(${ACID}, ${(pass - 0.85) / 0.15})`;
        context.font = "9px var(--font-mono, monospace)";
        context.textBaseline = "middle";
        context.fillText("PRODUCTION", trackRight + 6 - 60, approvedY - 12);
      }

      // Block beat: a stale version's signal reaches the gate and stops dead,
      // rather than continuing — the room's actual claim.
      const staleIndex = VERSIONS.findIndex((version) => !version.approved && version.score === Math.max(
        ...VERSIONS.filter((v) => !v.approved).map((v) => v.score),
      ));
      const stale = VERSIONS[staleIndex];
      const staleY = inset.top + rowGap * (staleIndex + 0.5) + 10;
      const staleStart = trackLeft + trackWidth * 0.55 * stale.score;
      if (block > 0) {
        const reach = Math.min(block * 1.4, 1);
        const bx = staleStart + (gateX - staleStart) * reach;
        context.strokeStyle = `rgba(${LUME}, ${0.4 * block})`;
        context.beginPath();
        context.moveTo(staleStart, staleY);
        context.lineTo(bx, staleY);
        context.stroke();
        if (reach >= 1) {
          const flash = clamp01((block - 0.7) * 3.2);
          context.strokeStyle = `rgba(${WARN}, ${0.8 * (1 - flash * 0.3)})`;
          context.lineWidth = 1.5;
          context.beginPath();
          context.moveTo(gateX - 4, staleY - 4);
          context.lineTo(gateX + 4, staleY + 4);
          context.moveTo(gateX + 4, staleY - 4);
          context.lineTo(gateX - 4, staleY + 4);
          context.stroke();
          context.lineWidth = 1;
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
