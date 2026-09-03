"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";

/**
 * Department 05's instrument. Where the Render Line resolves a script into a
 * master the floor can release, the Release Compositor resolves that master's
 * *packaging* — title candidates and thumbnail concepts, each carrying its own
 * deception-risk judgement — into the one exact package that is allowed to
 * leave for distribution.
 *
 * Unlike the Version Gate (one strategy compared against itself over time)
 * or the Render Line (one master swept past sequential checkpoints), this
 * instrument runs two independent candidate racks — titles, thumbnails — at
 * once and composites, not routes: a title and a thumbnail converge into one
 * locked object rather than travelling a shared line.
 *
 *   RACK       title candidates and thumbnail concepts are laid out, unranked.
 *   ASSESS     each candidate's deception risk is judged and marked.
 *   REJECT     the material-risk candidates are struck through and held in
 *              the record, not deleted — Channelwright's packaging stage
 *              proposes candidates, it never silently discards the count.
 *   CONVERGE   the one surviving title and the one surviving thumbnail send a
 *              beam toward the compositor at centre-right.
 *   LOCK       the two beams resolve into a single release package, bound to
 *              the strategy hypothesis it tests, and stamped at an exact
 *              version.
 *   HAND OFF   the locked package leaves the room toward Analytics Command.
 *
 * Colour means status, as in every room: lume is unresolved or rejected,
 * warn is a material deception-risk finding, acid is selected and locked.
 */

const LUME = "242, 239, 230";
const ACID = "216, 255, 62";
const WARN = "255, 104, 70";

type Candidate = {
  label: string;
  risk: "none" | "low" | "material";
  selected?: boolean;
};

const TITLES: Candidate[] = [
  { label: "I Tried the $10 Setup for 30 Days", risk: "low" },
  { label: "This Beats a $500 Rig", risk: "material" },
  { label: "The $10 Setup, Tested Honestly", risk: "none", selected: true },
  { label: "You're Overspending on This", risk: "low" },
  { label: "Why I Switched Back", risk: "none" },
];

const THUMBS: Candidate[] = [
  { label: "Split-frame · cheap vs. expensive", risk: "none", selected: true },
  { label: "Shock face · red arrow", risk: "material" },
  { label: "Product flat-lay · plain text", risk: "none" },
  { label: "Before/after crop, no context", risk: "low" },
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

function riskTone(risk: Candidate["risk"]) {
  return risk === "material" ? WARN : LUME;
}

export function ReleaseCompositor() {
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
      const inset = { left: 18, right: 78, top: 20, bottom: 18 };
      const trackLeft = inset.left;
      const trackRight = width - inset.right;
      const trackWidth = trackRight - trackLeft;
      const usableHeight = height - inset.top - inset.bottom;
      const titleRowGap = (usableHeight * 0.56) / TITLES.length;
      const thumbTop = inset.top + usableHeight * 0.6;
      const thumbRowGap = (usableHeight * 0.4) / THUMBS.length;
      const rackWidth = trackWidth * 0.66;
      const lockX = trackRight - 6;

      context.clearRect(0, 0, width, height);

      const rack = easeOut(ramp(progress, 0.03, 0.22));
      const assess = ramp(progress, 0.16, 0.34);
      const reject = ramp(progress, 0.3, 0.5);
      const converge = ramp(progress, 0.46, 0.76);
      const lock = easeOut(ramp(progress, 0.76, 0.88));
      const handoff = easeOut(ramp(progress, 0.88, 0.99));

      const selectedTitleIndex = TITLES.findIndex((c) => c.selected);
      const selectedThumbIndex = THUMBS.findIndex((c) => c.selected);

      const drawRack = (
        candidates: Candidate[],
        top: number,
        rowGap: number,
      ) => {
        candidates.forEach((candidate, index) => {
          const y = top + rowGap * (index + 0.5);
          const targetWidth = rackWidth * (0.44 + (index % 3) * 0.16);
          const barWidth = targetWidth * rack;
          const isRejected = !candidate.selected && candidate.risk === "material";
          const rejectDrift = isRejected ? reject : 0;
          const rowY = y + rejectDrift * 8;
          const dim = candidate.selected ? 1 : isRejected ? 1 - reject * 0.55 : 0.78;
          const tone = assess > 0.15 ? riskTone(candidate.risk) : LUME;

          context.globalAlpha = 0.16 + rack * 0.5 * dim;
          context.fillStyle = `rgba(${tone}, 1)`;
          context.fillRect(trackLeft, rowY - 2.5, barWidth, 5);
          context.globalAlpha = 1;

          // Deception-risk mark: a small tick at the bar's tip once assessed.
          if (assess > 0.1) {
            const markAlpha = clamp01(assess * 1.6);
            context.fillStyle = `rgba(${riskTone(candidate.risk)}, ${markAlpha * (candidate.risk === "material" ? 0.95 : 0.55)})`;
            context.beginPath();
            context.arc(trackLeft + targetWidth + 6, rowY, candidate.risk === "material" ? 2.6 : 1.8, 0, Math.PI * 2);
            context.fill();
          }

          // Reject: struck through, held visible rather than removed.
          if (isRejected && reject > 0.05) {
            context.strokeStyle = `rgba(${LUME}, ${0.5 * reject})`;
            context.beginPath();
            context.moveTo(trackLeft, rowY);
            context.lineTo(trackLeft + Math.max(barWidth, targetWidth) + 10, rowY);
            context.stroke();
          }
        });
      };

      drawRack(TITLES, inset.top, titleRowGap);
      drawRack(THUMBS, thumbTop, thumbRowGap);

      // Rack labels.
      if (rack > 0.3) {
        context.fillStyle = `rgba(${LUME}, ${0.55 * rack})`;
        context.font = "7px var(--font-mono, monospace)";
        context.fillText("TITLE CANDIDATES", trackLeft, inset.top - 8);
        context.fillText("THUMBNAIL CONCEPTS", trackLeft, thumbTop - 8);
      }

      // Compositor frame: sits at the right edge, fed by both racks.
      const compositorY = inset.top + usableHeight * 0.5;
      const compositorSize = Math.min(usableHeight * 0.34, 46);

      context.strokeStyle = `rgba(${LUME}, .22)`;
      context.lineWidth = 1;
      context.strokeRect(lockX - compositorSize, compositorY - compositorSize / 2, compositorSize, compositorSize);

      // Converge: beams from each selected candidate travel to the compositor.
      const drawBeam = (fromY: number, fromWidth: number) => {
        if (converge <= 0) return;
        const startX = trackLeft + fromWidth;
        const endX = lockX - compositorSize;
        const bx = startX + (endX - startX) * converge;
        const by = fromY + (compositorY - fromY) * converge;
        context.strokeStyle = `rgba(${ACID}, ${0.55 * converge})`;
        context.beginPath();
        context.moveTo(startX, fromY);
        context.lineTo(bx, by);
        context.stroke();
        context.fillStyle = `rgba(${ACID}, ${0.9 * converge})`;
        context.beginPath();
        context.arc(bx, by, 2.4, 0, Math.PI * 2);
        context.fill();
      };

      if (selectedTitleIndex >= 0) {
        const y = inset.top + titleRowGap * (selectedTitleIndex + 0.5);
        const w = rackWidth * (0.44 + (selectedTitleIndex % 3) * 0.16);
        drawBeam(y, w);
      }
      if (selectedThumbIndex >= 0) {
        const y = thumbTop + thumbRowGap * (selectedThumbIndex + 0.5);
        const w = rackWidth * (0.44 + (selectedThumbIndex % 3) * 0.16);
        drawBeam(y, w);
      }

      // Lock: the compositor fills solid and is stamped at an exact version.
      if (lock > 0.02) {
        context.globalAlpha = 0.14 + lock * 0.6;
        context.fillStyle = `rgba(${ACID}, 1)`;
        context.fillRect(lockX - compositorSize, compositorY - compositorSize / 2, compositorSize, compositorSize);
        context.globalAlpha = 1;
        context.strokeStyle = `rgba(${ACID}, ${Math.min(lock * 1.3, 0.95)})`;
        context.lineWidth = 1.2;
        context.strokeRect(lockX - compositorSize - 4, compositorY - compositorSize / 2 - 4, compositorSize + 8, compositorSize + 8);
        context.lineWidth = 1;
        if (lock > 0.45) {
          context.fillStyle = `rgba(${ACID}, ${(lock - 0.45) / 0.55})`;
          context.font = "8px var(--font-mono, monospace)";
          context.textAlign = "center";
          context.fillText("RELEASE v1", lockX - compositorSize / 2, compositorY - compositorSize / 2 - 10);
          context.textAlign = "left";
        }
      }

      // Hand off: the locked package leaves toward Analytics Command.
      if (handoff > 0) {
        const hx = lockX - compositorSize / 2;
        const hy = compositorY;
        const runLength = width - inset.right - hx + 40;
        const tx = hx + runLength * handoff;
        context.strokeStyle = `rgba(${ACID}, ${0.5 * handoff})`;
        context.beginPath();
        context.moveTo(hx, hy);
        context.lineTo(Math.min(tx, width - 4), hy);
        context.stroke();
        context.fillStyle = `rgba(${ACID}, ${0.9 * handoff})`;
        context.beginPath();
        context.arc(Math.min(tx, width - 4), hy, 2.6, 0, Math.PI * 2);
        context.fill();
      }
      if (handoff > 0.75) {
        context.fillStyle = `rgba(${ACID}, ${(handoff - 0.75) / 0.25})`;
        context.font = "9px var(--font-mono, monospace)";
        context.textBaseline = "middle";
        context.fillText("ANALYTICS COMMAND", width - inset.right - 6, compositorY - 20);
        context.textBaseline = "alphabetic";
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
