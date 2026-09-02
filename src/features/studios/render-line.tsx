"use client";

import { useEffect, useRef } from "react";
import { registerScene } from "./scroll-engine";

/**
 * Department 04's instrument. Where the Script Sequencer resolves a brief
 * into a script the room can defend, the Render Line resolves that script
 * into a master the floor can release — a composition that renders once,
 * deterministically, and then cannot leave until every independent gate
 * checking it reports a pass.
 *
 *   BUILD    the approved script becomes a rendered composition — a solid
 *            block forming on the line, not a document any more.
 *   PROBE    the render is measured against itself: container, codecs,
 *            loudness and checksum, ticked off as they are confirmed.
 *   GATE     the master travels station to station past six independent
 *            checks — technical, rights, claims, visual, subjective-audio,
 *            platform — each lighting only once its own check clears.
 *   LOCK     a human approves the exact version that cleared every gate.
 *   HAND OFF the approved master leaves the floor toward Control Room.
 *
 * Colour means status, as in every room: lume is unresolved or in transit,
 * acid is a gate cleared and the version locked.
 */

const LUME = "242, 239, 230";
const ACID = "216, 255, 62";

const GATES = ["TECH", "RIGHTS", "CLAIMS", "VISUAL", "AUDIO", "PLATFORM"];

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

export function RenderLine() {
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
      const inset = { left: 18, right: 66, top: 26, bottom: 30 };
      const trackLeft = inset.left;
      const trackRight = width - inset.right;
      const trackWidth = trackRight - trackLeft;
      const rowY = inset.top + (height - inset.top - inset.bottom) * 0.46;
      const blockSize = (height - inset.top - inset.bottom) * 0.34;

      context.clearRect(0, 0, width, height);

      const build = easeOut(ramp(progress, 0.04, 0.24));
      const probe = ramp(progress, 0.18, 0.32);
      const travel = ramp(progress, 0.3, 0.76);
      const lock = easeOut(ramp(progress, 0.76, 0.88));
      const handoff = easeOut(ramp(progress, 0.88, 0.99));

      // Baseline rail the packet rides — the line itself.
      context.strokeStyle = `rgba(${LUME}, .22)`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(trackLeft, rowY);
      context.lineTo(trackRight, rowY);
      context.stroke();

      // Six gate stations, evenly spaced along the line.
      const gateSpan = trackWidth * 0.86;
      const gateStart = trackLeft + trackWidth * 0.06;
      const stations = GATES.map((label, index) => ({
        label,
        x: gateStart + (gateSpan * (index + 0.5)) / GATES.length,
      }));

      // The packet's position: idle at the left until built, then travels the
      // full line once probed, clearing each station it passes.
      const packetX = trackLeft + 14 + (trackRight - trackLeft - 28) * travel;

      stations.forEach((station) => {
        const cleared = travel > 0 && packetX >= station.x;
        const flash = cleared && travel < 1 ? clamp01((packetX - station.x) / 18) : cleared ? 1 : 0;
        const tone = cleared ? ACID : LUME;
        const barTop = rowY - blockSize * 0.62;
        const barBottom = rowY + blockSize * 0.62;

        context.strokeStyle = `rgba(${tone}, ${cleared ? 0.32 + flash * 0.5 : 0.28})`;
        context.lineWidth = cleared ? 1.4 : 1;
        context.beginPath();
        context.moveTo(station.x, barTop);
        context.lineTo(station.x, barBottom);
        context.stroke();
        context.lineWidth = 1;

        if (build > 0.4) {
          context.fillStyle = `rgba(${tone}, ${cleared ? 0.9 : 0.55})`;
          context.font = "7px var(--font-mono, monospace)";
          context.textAlign = "center";
          context.fillText(station.label, station.x, barBottom + 12);
          context.textAlign = "left";
        }

        if (cleared) {
          context.fillStyle = `rgba(${ACID}, ${0.8 * flash})`;
          context.beginPath();
          context.arc(station.x, barTop - 6, 2, 0, Math.PI * 2);
          context.fill();
        }
      });

      // The rendered master itself: a block that forms at the head of the
      // line, then rides the packet position across every station.
      const size = blockSize * (0.5 + build * 0.5);
      const bx = build < 1 ? trackLeft + 14 : packetX;
      context.globalAlpha = 0.2 + build * 0.65;
      context.fillStyle = `rgba(${LUME}, 1)`;
      context.fillRect(bx - size / 2, rowY - size / 2, size, size);
      context.globalAlpha = 1;
      context.strokeStyle = `rgba(${lock > 0.15 ? ACID : LUME}, ${0.4 + build * 0.4})`;
      context.strokeRect(bx - size / 2, rowY - size / 2, size, size);

      // Probe ticks: container, codecs, loudness, checksum — confirmed one
      // by one along the top of the block once it exists.
      if (probe > 0) {
        const marks = Math.round(4 * probe);
        for (let m = 0; m < marks; m++) {
          const tx = bx - size / 2 + 5 + m * 6;
          context.fillStyle = `rgba(${ACID}, .85)`;
          context.fillRect(tx, rowY - size / 2 - 7, 3, 3);
        }
      }

      // Lock: once every gate has cleared, a human approval stamp closes
      // around the master at an exact version.
      if (lock > 0.05) {
        const lockSize = size + 10;
        context.strokeStyle = `rgba(${ACID}, ${Math.min(lock * 1.2, 0.95)})`;
        context.lineWidth = 1.2;
        context.strokeRect(packetX - lockSize / 2, rowY - lockSize / 2, lockSize, lockSize);
        context.lineWidth = 1;
        if (lock > 0.5) {
          context.fillStyle = `rgba(${ACID}, ${(lock - 0.5) * 2})`;
          context.font = "8px var(--font-mono, monospace)";
          context.textAlign = "center";
          context.fillText("v1 APPROVED", packetX, rowY - lockSize / 2 - 8);
          context.textAlign = "left";
        }
      }

      // Hand off: the approved master leaves the line toward Control Room.
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
        context.fillText("CONTROL ROOM", trackRight - 78, rowY - 20);
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
