"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";
import { ACID, LUME, WARN, easeOut, fit, monoFamily, ramp } from "./instrument";

/**
 * Department 05's instrument. Where the Render Line resolves a script into a
 * master the floor can release, the Release Compositor resolves that master's
 * *packaging* — title candidates and thumbnail concepts, each carrying its own
 * deception-risk judgement — into the one exact package that is allowed to
 * leave for distribution.
 *
 * Unlike the Version Gate (one strategy compared against itself over time) or
 * the Render Line (one master swept past sequential checkpoints), this
 * instrument runs two independent candidate racks at once and *composites*:
 * a title and a thumbnail converge into one locked object rather than
 * travelling a shared line. So it is drawn as two review sheets, not a chart —
 * the candidates are named, because the whole point of the room is that a
 * human is choosing between specific things.
 *
 *   RACK       title candidates and thumbnail concepts are laid out, unranked.
 *   ASSESS     each candidate's deception risk is judged and marked.
 *   REJECT     the material-risk candidates are struck through and held in
 *              the record, not deleted.
 *   CONVERGE   the one surviving title and the one surviving thumbnail send a
 *              beam toward the compositor at the right.
 *   LOCK       the two beams resolve into a single release package, stamped
 *              at an exact version.
 *   HAND OFF   the locked package leaves the room toward Analytics Command.
 *
 * Colour means status, as in every room: lume is unresolved, warn is a
 * material deception-risk finding, acid is selected and locked.
 */

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

const RISK_LABEL: Record<Candidate["risk"], string> = {
  none: "CLEAR",
  low: "LOW",
  material: "MATERIAL",
};

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
    let mono = "monospace";

    const type = (size: number) => `${size}px ${mono}`;

    const paint = () => {
      if (width === 0 || height === 0) return;
      const pad = Math.max(12, Math.min(18, width * 0.034));

      // The compositor owns the right column; both racks share the left.
      const rightZone = Math.min(Math.max(width * 0.2, 76), 108);
      const rackRight = width - rightZone - 12;
      const riskRight = rackRight;
      const riskX = rackRight - Math.min(Math.max(width * 0.11, 38), 52);
      const labelMax = riskX - pad - 16;

      // Two sheets, not one list: the gap between the racks has to be wider
      // than the gap between rows or the second heading reads as another row.
      const split = 26;
      const usable = height - pad * 2 - 16 - split;
      const titlesTop = pad + 16;
      const titlesHeight = usable * (TITLES.length / (TITLES.length + THUMBS.length));
      const titleGap = titlesHeight / TITLES.length;
      const thumbsTop = titlesTop + titlesHeight + split;
      const thumbGap = (usable - titlesHeight) / THUMBS.length;

      const rack = easeOut(ramp(progress, 0.03, 0.22));
      const assess = ramp(progress, 0.16, 0.34);
      const reject = ramp(progress, 0.3, 0.5);
      const converge = ramp(progress, 0.46, 0.76);
      const lock = easeOut(ramp(progress, 0.76, 0.88));
      const handoff = easeOut(ramp(progress, 0.88, 0.99));

      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.textBaseline = "middle";

      /* --- Candidate racks ------------------------------------------------ */

      // Each candidate is a named row on a review sheet: the row's own state is
      // legible without the beam, the beam only says which one won.
      const drawRack = (candidates: Candidate[], top: number, gap: number, heading: string, ruled: boolean) => {
        context.font = type(7);
        context.textAlign = "left";
        context.fillStyle = `rgba(${LUME}, ${0.42 * rack})`;
        context.fillText(heading, pad, top - 9);
        // The risk column is headed once, over the first sheet: repeating it
        // reads as two tables rather than one judgement applied twice.
        if (ruled && assess > 0.2) {
          context.textAlign = "right";
          context.fillStyle = `rgba(${LUME}, ${0.34 * assess})`;
          context.fillText("DECEPTION RISK", riskRight, top - 9);
          context.textAlign = "left";
        }
        context.strokeStyle = `rgba(${LUME}, ${0.12 * rack})`;
        context.beginPath();
        context.moveTo(pad, top - 3);
        context.lineTo(rackRight, top - 3);
        context.stroke();

        candidates.forEach((candidate, index) => {
          const rejected = !candidate.selected && candidate.risk === "material";
          const y = top + gap * (index + 0.5) + (rejected ? reject * 5 : 0);
          const rowH = Math.min(gap - 3, 20);
          const live = candidate.selected ? 1 : rejected ? 1 - reject * 0.5 : 0.82;
          const tone = candidate.selected && converge > 0.05 ? ACID : LUME;

          // The selected row gets a lit plate: the panel's focal point.
          if (candidate.selected && converge > 0.05) {
            context.fillStyle = `rgba(${ACID}, ${0.055 * converge})`;
            context.fillRect(pad - 4, y - rowH / 2, rackRight - pad + 4, rowH);
          }
          // Left rule doubles as the rack's confidence bar while it fills in.
          context.fillStyle = `rgba(${tone}, ${(0.3 + rack * 0.55) * live})`;
          context.fillRect(pad - 4, y - rowH / 2, candidate.selected && converge > 0.05 ? 2 : 1, rowH * rack);

          context.font = type(7.5);
          context.fillStyle = `rgba(${LUME}, ${(0.3 + rack * 0.48) * live})`;
          context.fillText(fit(context, candidate.label, labelMax), pad + 6, y);

          // The judgement, in words, once the assess beat has run.
          if (assess > 0.1) {
            const material = candidate.risk === "material";
            context.font = type(6.5);
            context.fillStyle = `rgba(${riskTone(candidate.risk)}, ${
              (material ? 0.92 : 0.44) * Math.min(assess * 1.6, 1) * live
            })`;
            context.fillText(RISK_LABEL[candidate.risk], riskX, y);
          }

          // Reject: struck through, held visible rather than removed.
          if (rejected && reject > 0.05) {
            context.strokeStyle = `rgba(${WARN}, ${0.45 * reject})`;
            context.beginPath();
            context.moveTo(pad - 2, y);
            context.lineTo(riskRight, y);
            context.stroke();
          }
        });
      };

      drawRack(TITLES, titlesTop, titleGap, "TITLE CANDIDATES", true);
      drawRack(THUMBS, thumbsTop, thumbGap, "THUMBNAIL CONCEPTS", false);

      /* --- Compositor ----------------------------------------------------- */

      const compositorY = (titlesTop + thumbsTop + usable - titlesHeight) / 2;
      const size = Math.min(usable * 0.32, rightZone - 14, 56);
      const centreX = rackRight + 12 + (width - pad - rackRight - 12) / 2;

      context.strokeStyle = `rgba(${LUME}, ${0.2 + lock * 0.5})`;
      context.strokeRect(centreX - size / 2, compositorY - size / 2, size, size);

      // Converge: a beam from each selected row into the compositor. Two
      // inputs, one object — this room composites, it does not route.
      const beam = (fromY: number) => {
        if (converge <= 0) return;
        const startX = riskRight + 4;
        const endX = centreX - size / 2;
        const bx = startX + (endX - startX) * converge;
        const by = fromY + (compositorY - fromY) * converge;
        context.strokeStyle = `rgba(${ACID}, ${0.7 * converge})`;
        context.lineWidth = 1.3;
        context.beginPath();
        context.moveTo(startX, fromY);
        context.lineTo(bx, by);
        context.stroke();
        context.lineWidth = 1;
        context.fillStyle = `rgba(${ACID}, ${0.9 * converge})`;
        context.beginPath();
        context.arc(bx, by, 2.2, 0, Math.PI * 2);
        context.fill();
      };

      const titleIndex = TITLES.findIndex((candidate) => candidate.selected);
      const thumbIndex = THUMBS.findIndex((candidate) => candidate.selected);
      if (titleIndex >= 0) beam(titlesTop + titleGap * (titleIndex + 0.5));
      if (thumbIndex >= 0) beam(thumbsTop + thumbGap * (thumbIndex + 0.5));

      // Lock: the compositor fills and is stamped at an exact version.
      if (lock > 0.02) {
        context.fillStyle = `rgba(${ACID}, ${0.12 + lock * 0.55})`;
        context.fillRect(centreX - size / 2 + 3, compositorY - size / 2 + 3, size - 6, size - 6);
        context.strokeStyle = `rgba(${ACID}, ${Math.min(lock * 1.3, 0.95)})`;
        context.strokeRect(centreX - size / 2 - 4, compositorY - size / 2 - 4, size + 8, size + 8);
        if (lock > 0.4) {
          const stamped = (lock - 0.4) / 0.6;
          context.font = type(7);
          context.textAlign = "center";
          context.fillStyle = `rgba(${ACID}, ${stamped})`;
          context.fillText("RELEASE v1", centreX, compositorY - size / 2 - 13);
          context.fillStyle = `rgba(${LUME}, ${0.5 * stamped})`;
          context.fillText("1 TITLE · 1 THUMB", centreX, compositorY + size / 2 + 13);
          context.textAlign = "left";
        }
      }

      /* --- Hand off -------------------------------------------------------- */

      // The locked package leaves for Analytics Command. Right-aligned against
      // the canvas edge so the designation cannot run out of the panel.
      if (handoff > 0) {
        const startX = centreX + size / 2 + 4;
        const endX = width - 2;
        context.strokeStyle = `rgba(${ACID}, ${0.5 * handoff})`;
        context.beginPath();
        context.moveTo(startX, compositorY);
        context.lineTo(startX + (endX - startX) * handoff, compositorY);
        context.stroke();
        context.fillStyle = `rgba(${ACID}, ${0.9 * handoff})`;
        context.beginPath();
        context.arc(startX + (endX - startX) * handoff, compositorY, 2.4, 0, Math.PI * 2);
        context.fill();
      }
      if (handoff > 0.72) {
        context.font = type(7);
        context.textAlign = "right";
        context.fillStyle = `rgba(${ACID}, ${(handoff - 0.72) / 0.28})`;
        context.fillText("ANALYTICS COMMAND", width - 2, compositorY - 12);
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
