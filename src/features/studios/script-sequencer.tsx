"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";

/**
 * Department 03's instrument. Where the Version Gate resolves candidates into
 * one approved decision, the Script Sequencer resolves an approved brief into
 * a *structured, checked* script — five timed sections assembling in order,
 * each carrying claims bound to sources, one caught by QA and corrected
 * in place, then locked and handed to Production.
 *
 *   ASSEMBLE  sections rise into place in script order, not all at once.
 *   SOURCE    each section accumulates the source-bound claims it carries.
 *   SCAN      an independent QA pass sweeps the sequence left to right.
 *   FLAG      one section fails the pass and is marked for revision.
 *   REVISE    the flagged section is corrected within the pass, not thrown out.
 *   LOCK      every section is stamped, in order, once it clears QA.
 *   HAND OFF  the locked script leaves the room toward Production.
 *
 * Colour again means status: lume is drafted-but-unchecked, acid is
 * QA-cleared and locked, warn is the one section still being corrected.
 */

const LUME = "242, 239, 230";
const ACID = "216, 255, 62";
const WARN = "255, 104, 70";

type Section = {
  label: string;
  weight: number;
  claims: number;
  flagged?: boolean;
};

const SECTIONS: Section[] = [
  { label: "HOOK", weight: 0.14, claims: 1 },
  { label: "SETUP", weight: 0.2, claims: 2 },
  { label: "EVIDENCE", weight: 0.28, claims: 3, flagged: true },
  { label: "TURN", weight: 0.22, claims: 3 },
  { label: "PAYOFF", weight: 0.16, claims: 2 },
];

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

export function ScriptSequencer() {
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

    const flaggedIndex = SECTIONS.findIndex((section) => section.flagged);

    const paint = () => {
      if (width === 0 || height === 0) return;
      const inset = { left: 16, right: 70, top: 26, bottom: 30 };
      const trackLeft = inset.left;
      const trackRight = width - inset.right;
      const trackWidth = trackRight - trackLeft;
      const rowY = inset.top + (height - inset.top - inset.bottom) * 0.42;
      const barHeight = (height - inset.top - inset.bottom) * 0.5;

      context.clearRect(0, 0, width, height);

      // Precompute each section's slot along the timeline.
      let cursor = trackLeft;
      const slots = SECTIONS.map((section) => {
        const xStart = cursor;
        const segWidth = trackWidth * section.weight;
        cursor += segWidth;
        return { ...section, xStart, segWidth };
      });

      const scan = ramp(progress, 0.44, 0.64);
      const scanActive = scan > 0 && scan < 1;
      const scanX = trackLeft + trackWidth * Math.min(scan, 1);
      const revise = ramp(progress, 0.58, 0.72);
      const handoff = easeOut(ramp(progress, 0.8, 0.98));

      // Baseline rail the sections sit on, so the row reads as one sequence.
      context.strokeStyle = `rgba(${LUME}, .22)`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(trackLeft, rowY + barHeight / 2 + 6);
      context.lineTo(trackRight, rowY + barHeight / 2 + 6);
      context.stroke();

      slots.forEach((slot, index) => {
        const draft = easeOut(ramp(progress, 0.04 + index * 0.035, 0.2 + index * 0.035));
        const source = ramp(progress, 0.3 + index * 0.02, 0.42 + index * 0.02);
        const lock = easeOut(ramp(progress, 0.66 + index * 0.02, 0.76 + index * 0.02));

        // Has the scan line already swept past this section's midpoint?
        const scanned = scanX > slot.xStart + slot.segWidth * 0.4;
        const isFlagged = index === flaggedIndex;
        const warnOn = isFlagged && scanned && revise < 0.9;
        const cleared = !isFlagged || revise >= 0.9;

        const tone = lock > 0.15 && cleared ? ACID : warnOn ? WARN : LUME;
        const barH = barHeight * draft * (isFlagged ? 1 - Math.min(revise, 0.3) * 0.25 : 1);

        context.globalAlpha = 0.16 + draft * 0.6;
        context.fillStyle = `rgba(${tone}, 1)`;
        context.fillRect(slot.xStart + 2, rowY - barH / 2, Math.max(slot.segWidth - 4, 1), barH);
        context.globalAlpha = 1;

        if (draft > 0.15) {
          context.strokeStyle = `rgba(${tone}, ${0.3 + lock * 0.4})`;
          context.strokeRect(slot.xStart + 2, rowY - barH / 2, Math.max(slot.segWidth - 4, 1), barH);
        }

        // Claims: ticks accumulating along the top of the section as its
        // sources bind, so "sourced" is something the eye can count.
        if (source > 0) {
          const shown = Math.round(slot.claims * source);
          for (let c = 0; c < shown; c++) {
            const tx = slot.xStart + 8 + c * 7;
            if (tx > slot.xStart + slot.segWidth - 6) break;
            context.fillStyle = `rgba(${ACID}, .85)`;
            context.fillRect(tx, rowY - barH / 2 - 7, 3, 3);
          }
        }

        // Lock pip: appears once the section has cleared QA and is stamped.
        if (lock > 0.2 && cleared) {
          context.strokeStyle = `rgba(${ACID}, ${Math.min(lock * 1.3, 1)})`;
          context.lineWidth = 1.2;
          const px = slot.xStart + slot.segWidth - 10;
          const py = rowY - barH / 2 - 6;
          context.beginPath();
          context.rect(px - 3, py - 3, 6, 6);
          context.stroke();
          context.lineWidth = 1;
        }

        // Section label, legible once drafted.
        if (draft > 0.3) {
          context.fillStyle = `rgba(${tone}, ${Math.min(draft, 1) * 0.75})`;
          context.font = "8px var(--font-mono, monospace)";
          context.textBaseline = "alphabetic";
          context.fillText(slot.label, slot.xStart + 4, rowY + barHeight / 2 + 20);
        }
      });

      // QA scan line sweeping the sequence.
      if (scanActive) {
        context.strokeStyle = `rgba(${ACID}, .55)`;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(scanX, inset.top);
        context.lineTo(scanX, height - inset.bottom + 4);
        context.stroke();
        context.lineWidth = 1;
      }

      // Flag mark on the section under correction.
      if (flaggedIndex >= 0) {
        const flagged = slots[flaggedIndex];
        const flaggedWarn = scanX > flagged.xStart + flagged.segWidth * 0.4 && revise < 0.55 && revise > 0;
        const flaggedShown = scanX > flagged.xStart + flagged.segWidth * 0.4 && revise < 0.9;
        if (flaggedShown) {
          const alpha = flaggedWarn ? 0.85 : 0.85 * (1 - clamp01((revise - 0.55) / 0.35));
          if (alpha > 0.02) {
            context.fillStyle = `rgba(${WARN}, ${alpha})`;
            context.font = "8px var(--font-mono, monospace)";
            context.fillText("REVISE", flagged.xStart + 2, rowY - barHeight / 2 - 16);
          }
        }
      }

      // Handoff: the locked sequence travels off the right edge toward
      // Production once every section is stamped.
      if (handoff > 0) {
        const hx = trackRight - 46 + 46 * handoff;
        context.strokeStyle = `rgba(${ACID}, ${0.5 * handoff})`;
        context.beginPath();
        context.moveTo(trackRight - 46, rowY);
        context.lineTo(Math.min(hx, trackRight), rowY);
        context.stroke();
        context.fillStyle = `rgba(${ACID}, ${0.9 * handoff})`;
        context.beginPath();
        context.arc(Math.min(hx, trackRight), rowY, 2.6, 0, Math.PI * 2);
        context.fill();
      }
      if (handoff > 0.8) {
        context.fillStyle = `rgba(${ACID}, ${(handoff - 0.8) / 0.2})`;
        context.font = "9px var(--font-mono, monospace)";
        context.textBaseline = "middle";
        context.fillText("PRODUCTION", trackRight - 60, rowY - 20);
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
