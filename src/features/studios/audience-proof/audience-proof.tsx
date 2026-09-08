"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { registerScene } from "../scroll-engine";
import { overlayOpacities, poseWeights, TURN_WINDOWS } from "./choreography";
import styles from "./audience-proof.module.css";

const ASSETS = "/design-assets/audience-proof";
const PLATES = { a: "diverted-a.png", b: "transition-b.png", c: "master-c.png" } as const;
type View = "masked" | "full" | "a" | "b" | "c";
type Driver = "scroll" | "manual";
const SAMPLES = [
  [0, "Entry"], [0.25, "Early"], [0.5, "Middle"], [0.75, "Near final"], [0.85, "Final hold"],
] as const;

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The proof must show source pixels without optimization, alternate encodings,
// resampling settings or transition effects that could obscure registration errors.
function Plate({ pose, className }: { pose: keyof typeof PLATES; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={`${ASSETS}/${PLATES[pose]}`} width={1536} height={1024}
      alt="" aria-hidden="true" decoding="async" draggable={false} />
  );
}

export default function AudienceProof() {
  const scene = useRef<HTMLElement>(null);
  const photograph = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLOutputElement>(null);
  const progress = useRef(0);
  const scrollProgress = useRef(0);
  const driverRef = useRef<Driver>("scroll");
  const [driver, setDriver] = useState<Driver>("scroll");
  const [view, setView] = useState<View>("masked");
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => false);

  function paint(value: number) {
    progress.current = value;
    const element = photograph.current;
    if (!element) return;
    element.dataset.progress = value.toFixed(4);
    for (const [person, window] of Object.entries(TURN_WINDOWS)) {
      const opacity = overlayOpacities(poseWeights(value, window));
      element.style.setProperty(`--${person}-a`, String(opacity.a));
      element.style.setProperty(`--${person}-b`, String(opacity.b));
    }
    if (slider.current) slider.current.value = String(value);
    if (readout.current) readout.current.value = `${Math.round(value * 100)}%`;
  }

  useEffect(() => {
    let disposed = false;
    // Decode all exact evaluation plates before revealing any motion layers.
    const images = Array.from(photograph.current?.querySelectorAll("img") ?? []);
    Promise.all(images.map((image) => image.decode())).then(() => {
      if (!disposed) setStatus("ready");
    }).catch(() => {
      if (!disposed) setStatus("failed");
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    const element = scene.current;
    if (!element || reduced || status !== "ready") return;
    return registerScene({
      element,
      apply(value) {
        scrollProgress.current = value;
        if (driverRef.current === "scroll") paint(value);
      },
    });
  }, [reduced, status]);

  function selectDriver(next: Driver) {
    driverRef.current = next;
    setDriver(next);
    if (next === "scroll") paint(scrollProgress.current);
  }

  function sample(value: number) {
    selectDriver("manual");
    setView((current) => current === "a" || current === "b" || current === "c" ? "masked" : current);
    paint(value);
  }

  const enabled = status === "ready" && !reduced;
  const isStill = view === "a" || view === "b" || view === "c";

  return (
    <main id="main" className={styles.proof} data-ready={status === "ready"} data-reduced={reduced}>
      <header className={styles.header}>
        <Link href="/studios-preview">Channelwright Studios</Link>
        <span>Audience study / 02</span>
      </header>
      <section ref={scene} className={styles.scene} aria-labelledby="proof-title">
        <div className={styles.stage}>
          <div className={styles.heading}>
            <h1 id="proof-title">Two people. Three poses.</h1>
            <p>Attention-transfer proof · source plates and held blends</p>
          </div>
          <div className={styles.controls}>
            <fieldset disabled={!enabled} className={styles.toolbar}>
              <legend className={styles.srOnly}>Experiment controls</legend>
              <div className={styles.mode} aria-label="Progress source">
                <button type="button" aria-pressed={driver === "scroll"} onClick={() => selectDriver("scroll")}>Scroll</button>
                <button type="button" aria-pressed={driver === "manual"} onClick={() => selectDriver("manual")}>Manual</button>
              </div>
              <label className={styles.viewLabel}>View
                <select value={view} onChange={(event) => setView(event.target.value as View)}>
                  <option value="masked">Localized heads · staggered</option>
                  <option value="full">Full plates · baseline dissolve</option>
                  <option value="a">Source A · diverted</option>
                  <option value="b">Source B · transition</option>
                  <option value="c">Source C · direct</option>
                </select>
              </label>
              <div className={styles.samples} aria-label="Held progress samples">
                {SAMPLES.map(([value, label]) => (
                  <button key={value} type="button" onClick={() => sample(value)}>{label}</button>
                ))}
              </div>
              <label className={styles.scrubber} htmlFor="attention-progress">Progress
                <input ref={slider} id="attention-progress" type="range" min="0" max="1" step="0.001"
                  defaultValue="0" onChange={(event) => sample(Number(event.target.value))} />
                <output ref={readout} htmlFor="attention-progress">0%</output>
              </label>
            </fieldset>
          </div>
          <figure className={styles.figure}>
            <div ref={photograph} className={styles.photograph} data-view={view} data-progress="0"
              role="img" aria-label="Two seated adults wearing red and cyan 3D glasses. The experiment compares their diverted, transitional, and camera-facing poses.">
              <Plate pose="c" className={styles.base} />
              <div className={`${styles.motionLayer} ${styles.full}`} aria-hidden="true">
                <Plate pose="b" className={styles.fullB} /><Plate pose="a" className={styles.fullA} />
              </div>
              {(["left", "right"] as const).map((person) => (
                <div key={person} className={`${styles.motionLayer} ${styles.head} ${styles[person]}`} aria-hidden="true">
                  <Plate pose="b" className={styles.headB} /><Plate pose="a" className={styles.headA} />
                </div>
              ))}
              <div className={`${styles.motionLayer} ${styles.still}`} aria-hidden="true">
                <Plate pose={isStill ? view : "c"} />
              </div>
            </div>
            <figcaption className={styles.caption}>
              <span>{reduced ? "Reduced motion · canonical C" : status === "failed" ? "Asset loading failed · canonical C fallback" : status !== "ready" ? "Canonical C · preparing source plates" : isStill ? `Source ${view.toUpperCase()} · no interpolation` : view === "masked" ? "Fixed C surroundings · two independent head regions" : "Full-frame A → B → C · registration baseline"}</span>
              <span>{!reduced && status === "ready" && !isStill ? "Final hold 85–100%" : "Static inspection"}</span>
            </figcaption>
          </figure>
          <p className={styles.note}>Inspect the glasses, nose, hairline and neck at held intermediate positions. Controls are diagnostic; this is not the finished footer.</p>
          <noscript><p className={styles.note}>JavaScript is disabled. The canonical final-facing image is shown.</p></noscript>
        </div>
      </section>
    </main>
  );
}
