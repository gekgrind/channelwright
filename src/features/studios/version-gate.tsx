"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";
import { ACID, LUME, WARN, clamp01, easeOut, fit, monoFamily, ramp } from "./instrument";

/**
 * Department 02's instrument. Where the Opportunity Plot resolves noise into
 * one selected candidate, the Version Gate resolves *candidate strategies*
 * into one approved, versioned decision — and then demonstrates the gate
 * that decision buys: a stale version's signal cannot start production.
 *
 *   FILE       three strategy versions are drafted, unranked.
 *   COMPARE    each is measured against the others on a shared fit scale.
 *   SUPERSEDE  the weaker two are struck through and retired to the record
 *              (not deleted — Department 02's whole claim is that nothing
 *              is silently thrown away).
 *   APPROVE    the surviving version is bound to a version number, and the
 *              gate opens on that row and no other.
 *   GATE       the approved signal passes into production; a superseded
 *              signal reaches the same gate and is blocked.
 *
 * It is drawn as a version record rather than a chart: every row carries its
 * designation, its measured fit and its state in words, so the panel says what
 * happened without the surrounding copy having to. Colour means status — lume
 * is unresolved or retired, acid is the one version production may run
 * against, warn is a signal the gate refused.
 */

type Version = {
  id: string;
  label: string;
  /** Illustrative fit score, 0..1 — the basis for the ranking, not a claim. */
  score: number;
  approved?: boolean;
};

const VERSIONS: Version[] = [
  { id: "v1", label: "Beginner tutorials", score: 0.41 },
  { id: "v2", label: "Niche deep-dives", score: 0.58 },
  { id: "v3", label: "Comparison series", score: 0.83, approved: true },
];

const APPROVED_INDEX = VERSIONS.findIndex((version) => version.approved);
/** The strongest superseded version: the one whose signal the gate must refuse. */
const STALE_INDEX = VERSIONS.reduce(
  (best, version, index) =>
    version.approved ? best : best < 0 || version.score > VERSIONS[best].score ? index : best,
  -1,
);

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
    let mono = "monospace";

    const type = (size: number) => `${size}px ${mono}`;

    const paint = () => {
      if (width === 0 || height === 0) return;
      const pad = Math.max(12, Math.min(18, width * 0.035));

      // Column structure. Every column is derived, so the record stays
      // readable from the wide desktop panel down to the phone crop.
      const rightZone = Math.min(Math.max(width * 0.17, 62), 92);
      const gateX = width - rightZone;
      const tagWidth = Math.min(Math.max(width * 0.13, 44), 62);
      const tagX = gateX - tagWidth - 6;
      const scoreRight = tagX - 8;
      const barRight = scoreRight - 22;
      const labelWidth = Math.min(Math.max(width * 0.26, 76), 128);
      const barLeft = pad + labelWidth + 10;
      const barSpan = Math.max(barRight - barLeft, 24);

      const headY = pad + 6;
      const scaleY = height - pad - 10;
      const rowsTop = headY + 12;
      const rowsBottom = scaleY - 20;
      const rowGap = (rowsBottom - rowsTop) / VERSIONS.length;
      const rowHeight = Math.min(rowGap - 8, 46);

      // The five beats. Overlapping ramps so nothing starts from a standstill.
      const file = easeOut(ramp(progress, 0.04, 0.32));
      const compare = ramp(progress, 0.26, 0.44);
      const supersede = ramp(progress, 0.4, 0.58);
      const approve = ramp(progress, 0.5, 0.64);
      const pass = easeOut(ramp(progress, 0.6, 0.86));
      const block = easeOut(ramp(progress, 0.66, 0.9));

      const rowY = (index: number) => rowsTop + rowGap * (index + 0.5);
      const approvedY = rowY(APPROVED_INDEX);

      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;

      /* --- Column headings ------------------------------------------------ */

      context.font = type(7);
      context.textBaseline = "middle";
      context.fillStyle = `rgba(${LUME}, ${0.42 * file})`;
      context.fillText("VERSION RECORD", pad, headY);
      context.textAlign = "right";
      context.fillText("FIT", scoreRight, headY);
      context.textAlign = "left";
      context.fillStyle = `rgba(${LUME}, ${0.42 * Math.max(file, approve)})`;
      context.fillText("GATE", gateX + 6, headY);

      context.strokeStyle = `rgba(${LUME}, ${0.14 * file})`;
      context.beginPath();
      context.moveTo(pad, headY + 7);
      context.lineTo(gateX - 4, headY + 7);
      context.stroke();

      /* --- The gate ------------------------------------------------------- */

      // A vertical bracket that opens on the approved row and nowhere else:
      // clearance is a property of one version, not of the room.
      const opening = rowHeight * 0.9 * clamp01(approve * 1.15);
      context.strokeStyle = `rgba(${LUME}, ${0.3 + approve * 0.24})`;
      context.lineWidth = 1.3;
      context.beginPath();
      context.moveTo(gateX, rowsTop - 4);
      context.lineTo(gateX, approvedY - opening / 2);
      context.moveTo(gateX, approvedY + opening / 2);
      context.lineTo(gateX, rowsBottom + 4);
      context.stroke();

      if (approve > 0.1) {
        // The open jaws are marked, so the break reads as a mechanism rather
        // than a gap in a line.
        context.strokeStyle = `rgba(${ACID}, ${0.85 * approve})`;
        context.lineWidth = 1.6;
        context.beginPath();
        context.moveTo(gateX - 4, approvedY - opening / 2);
        context.lineTo(gateX, approvedY - opening / 2);
        context.moveTo(gateX - 4, approvedY + opening / 2);
        context.lineTo(gateX, approvedY + opening / 2);
        context.stroke();
        context.lineWidth = 1;
      }

      /* --- Version rows --------------------------------------------------- */

      VERSIONS.forEach((version, index) => {
        const retire = version.approved ? 0 : supersede;
        const y = rowY(index) + retire * 6;
        const live = version.approved ? 1 : 1 - retire * 0.5;
        const targetWidth = barSpan * version.score;
        const barWidth = targetWidth * file;
        const selected = version.approved && approve > 0.08;
        const tone = selected ? ACID : LUME;

        // Approved row: a lit plate behind the whole row. This is the panel's
        // one focal point, and it arrives on the approve beat.
        if (selected) {
          context.fillStyle = `rgba(${ACID}, ${0.05 * approve})`;
          context.fillRect(pad - 4, y - rowHeight / 2, gateX - pad, rowHeight);
          context.fillStyle = `rgba(${ACID}, ${0.75 * approve})`;
          context.fillRect(pad - 4, y - rowHeight / 2, 2, rowHeight);
        }

        // Designation and title.
        context.font = type(9);
        context.textBaseline = "middle";
        context.fillStyle = `rgba(${tone}, ${(0.5 + file * 0.45) * live})`;
        context.fillText(version.id, pad + 4, y - 4);
        context.font = type(7.5);
        context.fillStyle = `rgba(${LUME}, ${(0.24 + file * 0.34) * live})`;
        context.fillText(fit(context, version.label, labelWidth - 22), pad + 24, y - 4);

        // Fit bar, on a shared track so the three are read against each other.
        context.fillStyle = `rgba(${LUME}, ${0.07 * file})`;
        context.fillRect(barLeft, y + 4, barSpan, 5);
        context.fillStyle = `rgba(${tone}, ${(0.24 + file * 0.5) * live})`;
        context.fillRect(barLeft, y + 4, barWidth, 5);

        // Compare: a tick at the measured score, so ranking is visible as a
        // measurement rather than asserted by bar length alone.
        if (compare > 0) {
          context.strokeStyle = `rgba(${tone}, ${0.5 * compare * live})`;
          context.beginPath();
          context.moveTo(barLeft + targetWidth, y);
          context.lineTo(barLeft + targetWidth, y + 13);
          context.stroke();
        }

        // Measured value, right-aligned in its own column.
        if (compare > 0.15) {
          context.font = type(8);
          context.textAlign = "right";
          context.fillStyle = `rgba(${tone}, ${(0.45 + compare * 0.4) * live})`;
          context.fillText(version.score.toFixed(2).slice(1), scoreRight, y + 6);
          context.textAlign = "left";
        }

        // State, in words. Superseded rows are struck through and kept.
        if (!version.approved && supersede > 0.05) {
          context.strokeStyle = `rgba(${LUME}, ${0.4 * supersede})`;
          context.beginPath();
          context.moveTo(pad + 4, y - 4);
          context.lineTo(barLeft + Math.max(targetWidth, 8), y - 4);
          context.stroke();
          context.font = type(6.5);
          context.fillStyle = `rgba(${LUME}, ${0.42 * supersede})`;
          context.fillText("SUPERSEDED", tagX, y + 6);
        }
        if (selected) {
          context.font = type(6.5);
          context.fillStyle = `rgba(${ACID}, ${0.92 * approve})`;
          context.fillText("APPROVED", tagX, y + 6);
        }
      });

      /* --- Fit scale ------------------------------------------------------ */

      // The scale the three bars were measured on, stated once at the foot.
      context.strokeStyle = `rgba(${LUME}, ${0.16 * file})`;
      context.beginPath();
      context.moveTo(barLeft, scaleY - 6);
      context.lineTo(barLeft + barSpan, scaleY - 6);
      for (let step = 0; step <= 4; step++) {
        const x = barLeft + (barSpan * step) / 4;
        context.moveTo(x, scaleY - 6);
        context.lineTo(x, scaleY - 2);
      }
      context.stroke();
      context.font = type(6.5);
      context.textBaseline = "middle";
      context.fillStyle = `rgba(${LUME}, ${0.34 * file})`;
      context.fillText("STRATEGY FIT", pad, scaleY - 4);
      context.fillText("0", barLeft - 1, scaleY + 5);
      context.textAlign = "right";
      context.fillText("1.0", barLeft + barSpan + 1, scaleY + 5);
      context.textAlign = "left";
      if (supersede > 0.4) {
        // In the left gutter, under the scale's own label: the note about the
        // record must never run into the scale's upper bound.
        context.fillStyle = `rgba(${LUME}, ${0.34 * supersede})`;
        context.fillText("2 RETAINED IN RECORD", pad, scaleY + 5);
      }

      /* --- Production node ------------------------------------------------ */

      const nodeSize = Math.min(rowHeight * 0.8, 30);
      const nodeX = gateX + (width - pad - gateX) / 2;
      context.strokeStyle = `rgba(${LUME}, ${0.18 + pass * 0.5})`;
      context.strokeRect(nodeX - nodeSize / 2, approvedY - nodeSize / 2, nodeSize, nodeSize);

      // Pass beat: the approved signal travels from its bar, through the open
      // jaws, into production — the only path the gate allows.
      if (pass > 0) {
        const start = barLeft + barSpan * VERSIONS[APPROVED_INDEX].score;
        const head = start + (nodeX - nodeSize / 2 - start) * pass;
        context.strokeStyle = `rgba(${ACID}, ${0.75 * pass})`;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(start, approvedY);
        context.lineTo(head, approvedY);
        context.stroke();
        context.lineWidth = 1;
        context.fillStyle = `rgba(${ACID}, ${0.9 * pass})`;
        context.beginPath();
        context.arc(head, approvedY, 2.4, 0, Math.PI * 2);
        context.fill();
      }
      if (pass > 0.86) {
        const landed = (pass - 0.86) / 0.14;
        context.fillStyle = `rgba(${ACID}, ${0.72 * landed})`;
        context.fillRect(nodeX - nodeSize / 2 + 3, approvedY - nodeSize / 2 + 3, nodeSize - 6, nodeSize - 6);
        context.font = type(6.5);
        context.textAlign = "center";
        context.fillStyle = `rgba(${ACID}, ${landed})`;
        context.fillText("PRODUCTION", nodeX, approvedY - nodeSize / 2 - 8);
        context.textAlign = "left";
      }

      /* --- Blocked signal -------------------------------------------------- */

      // The room's actual claim: a superseded version's signal reaches the same
      // gate and stops. Without this beat the panel would only show approval.
      if (block > 0 && STALE_INDEX >= 0) {
        const staleY = rowY(STALE_INDEX) + supersede * 6;
        const start = barLeft + barSpan * VERSIONS[STALE_INDEX].score;
        const reach = Math.min(block * 1.5, 1);
        context.strokeStyle = `rgba(${LUME}, ${0.34 * block})`;
        context.beginPath();
        context.moveTo(start, staleY);
        context.lineTo(start + (gateX - start) * reach, staleY);
        context.stroke();
        if (reach >= 1) {
          context.strokeStyle = `rgba(${WARN}, .85)`;
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo(gateX - 4, staleY - 4);
          context.lineTo(gateX + 4, staleY + 4);
          context.moveTo(gateX + 4, staleY - 4);
          context.lineTo(gateX - 4, staleY + 4);
          context.stroke();
          context.lineWidth = 1;
          context.font = type(6.5);
          context.fillStyle = `rgba(${WARN}, .85)`;
          context.fillText("BLOCKED", gateX + 8, staleY);
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
