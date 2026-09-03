"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";
import { ACID, LUME, WARN, clamp01, easeOut, fit, monoFamily, ramp } from "./instrument";

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

type Section = {
  label: string;
  /** Share of total runtime. The timeline is a runtime, not a bar chart. */
  weight: number;
  claims: number;
  flagged?: boolean;
};

/** Illustrative target runtime, stated so the timeline has a declared scale. */
const RUNTIME_SECONDS = 520;

function timecode(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

const SECTIONS: Section[] = [
  { label: "HOOK", weight: 0.14, claims: 1 },
  { label: "SETUP", weight: 0.2, claims: 2 },
  { label: "EVIDENCE", weight: 0.28, claims: 3, flagged: true },
  { label: "TURN", weight: 0.22, claims: 3 },
  { label: "PAYOFF", weight: 0.16, claims: 2 },
];

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
    let mono = "monospace";

    const type = (size: number) => `${size}px ${mono}`;

    const flaggedIndex = SECTIONS.findIndex((section) => section.flagged);

    const paint = () => {
      if (width === 0 || height === 0) return;
      const pad = Math.max(12, Math.min(16, width * 0.032));
      const inset = { left: pad, right: Math.min(Math.max(width * 0.15, 56), 76), top: pad + 14, bottom: pad + 24 };
      const trackLeft = inset.left;
      const trackRight = width - inset.right;
      const trackWidth = trackRight - trackLeft;
      // Three declared lanes: sourced claims above, the sequence itself, then
      // each section's QA verdict. The instrument fills its canvas because it
      // has three things to say, not because the bar was made taller.
      const lanesTop = inset.top;
      const lanesBottom = height - inset.bottom;
      // Bottom-up: the runtime ruler anchors the foot, the verdict and label
      // lanes stack above it, and the sequence itself takes every pixel that
      // is left. Nothing is capped into a strip with dead canvas beneath it.
      const scaleY = lanesBottom;
      const verdictY = scaleY - 18;
      const labelY = verdictY - 13;
      const barBottom = labelY - 14;
      // The timeline stays a strip. The band above it is not padding: it is
      // where the claims live, one rule per claim, so "11 claims sourced" is a
      // thing the eye can count rather than a number in the readout below.
      const barHeight = Math.min(Math.max((barBottom - lanesTop) * 0.34, 26), 78);
      const barTop = barBottom - barHeight;
      const rowY = (barTop + barBottom) / 2;
      const claimsTop = lanesTop + 12;
      const maxClaims = SECTIONS.reduce((most, section) => Math.max(most, section.claims), 1);
      const claimGap = Math.max((barTop - 16 - claimsTop) / maxClaims, 7);

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

      // Lane headings. Two words of chrome that turn three rows of marks into
      // a legible instrument.
      context.font = type(7);
      context.textBaseline = "middle";
      context.fillStyle = `rgba(${LUME}, .34)`;
      context.fillText("SOURCED CLAIMS", trackLeft, lanesTop);
      context.textAlign = "right";
      context.fillStyle = `rgba(${LUME}, .3)`;
      context.fillText(`RUNTIME ${timecode(RUNTIME_SECONDS)}`, trackRight, lanesTop);
      context.textAlign = "left";

      // Baseline rail the sections sit on, so the row reads as one sequence.
      context.strokeStyle = `rgba(${LUME}, .22)`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(trackLeft, barBottom + 4);
      context.lineTo(trackRight, barBottom + 4);
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

        // Status is carried by a lit edge over a low fill, not by a saturated
        // block. Five solid rectangles of acid and warn out-shouted the room's
        // headline; the section still reads as drafted, flagged or locked, but
        // it no longer competes with Level 1 for the eye.
        context.globalAlpha = 0.1 + draft * 0.26;
        context.fillStyle = `rgba(${tone}, 1)`;
        context.fillRect(slot.xStart + 2, rowY - barH / 2, Math.max(slot.segWidth - 4, 1), barH);
        context.globalAlpha = 1;

        if (draft > 0.15) {
          context.strokeStyle = `rgba(${tone}, ${0.42 + lock * 0.48})`;
          context.strokeRect(slot.xStart + 2, rowY - barH / 2, Math.max(slot.segWidth - 4, 1), barH);
        }

        // Claims: one rule per claim, stacked above its own section and each
        // pinned to a source. They bind in order as the section is sourced.
        if (source > 0) {
          const shown = Math.round(slot.claims * source);
          const claimWidth = Math.max(slot.segWidth - 12, 10);
          // A hairline from the section up through its own claims, so the
          // stack is visibly attached to the section that carries it.
          context.strokeStyle = `rgba(${LUME}, ${0.1 * source})`;
          context.beginPath();
          context.moveTo(slot.xStart + 4.5, claimsTop);
          context.lineTo(slot.xStart + 4.5, barTop);
          context.stroke();
          for (let c = 0; c < shown; c++) {
            const cy = claimsTop + c * claimGap;
            if (cy > barTop - 10) break;
            const bound = clamp01(slot.claims * source - c);
            context.fillStyle = `rgba(${LUME}, ${0.3 * bound})`;
            context.fillRect(slot.xStart + 8, cy, claimWidth * bound, 1);
            // The source pip: a claim without one is not sourced.
            context.fillStyle = `rgba(${ACID}, ${0.8 * bound})`;
            context.fillRect(slot.xStart + 3, cy - 1.5, 3, 3);
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

        // Section label and its share of runtime: the timeline states what it
        // is measuring rather than leaving the widths to be inferred.
        if (draft > 0.3) {
          context.textBaseline = "middle";
          context.fillStyle = `rgba(${tone}, ${Math.min(draft, 1) * 0.8})`;
          context.font = type(7.5);
          context.fillText(fit(context, slot.label, slot.segWidth - 30), slot.xStart + 3, labelY);
          if (slot.segWidth > 40) {
            context.font = type(6.5);
            context.fillStyle = `rgba(${LUME}, ${Math.min(draft, 1) * 0.34})`;
            context.textAlign = "right";
            context.fillText(timecode(RUNTIME_SECONDS * slot.weight), slot.xStart + slot.segWidth - 4, labelY);
            context.textAlign = "left";
          }
        }

        // QA verdict lane: every section carries its own outcome, so the pass
        // reads as five judgements rather than one sweeping line.
        if (scanned) {
          const passed = lock > 0.2 && cleared;
          context.font = type(6.5);
          context.textBaseline = "middle";
          context.fillStyle = warnOn
            ? `rgba(${WARN}, .9)`
            : `rgba(${ACID}, ${passed ? 0.8 : 0.3})`;
          context.fillText(warnOn ? "REVISE" : passed ? "PASS" : "···", slot.xStart + 3, verdictY);
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

      // Runtime ruler. The section widths are minutes, so the foot of the
      // instrument carries the scale that makes them readable as minutes.
      context.strokeStyle = `rgba(${LUME}, .16)`;
      context.beginPath();
      context.moveTo(trackLeft, scaleY - 6);
      context.lineTo(trackRight, scaleY - 6);
      let boundary = trackLeft;
      for (const slot of slots) {
        boundary += slot.segWidth;
        context.moveTo(boundary, scaleY - 6);
        context.lineTo(boundary, scaleY - 1);
      }
      context.stroke();
      context.font = type(6.5);
      context.textBaseline = "middle";
      context.fillStyle = `rgba(${LUME}, .32)`;
      context.fillText("0:00", trackLeft, scaleY + 4);
      context.textAlign = "center";
      context.fillText(timecode(RUNTIME_SECONDS / 2), trackLeft + trackWidth / 2, scaleY + 4);
      context.textAlign = "right";
      context.fillText(timecode(RUNTIME_SECONDS), trackRight, scaleY + 4);
      context.textAlign = "left";

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
        // Right-aligned against the canvas edge: the destination designation
        // must not be able to run out of the panel at any width.
        context.fillStyle = `rgba(${ACID}, ${(handoff - 0.8) / 0.2})`;
        context.font = type(7.5);
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillText("PRODUCTION", width - 2, barTop - 8);
        context.textAlign = "left";
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
