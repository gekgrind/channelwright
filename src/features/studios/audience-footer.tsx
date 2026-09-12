"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef } from "react";
import { Cue, Scene } from "./scene";
import { registerScene } from "./scroll-engine";
import { FOOTER, OPEN } from "./copy";

/**
 * The audience — the last act of Channelwright Studios, and its footer.
 *
 * The visitor has spent the page watching how media gets made. Here they
 * arrive in front of the people it is made for: an old cinema audience in
 * cardboard 3D glasses, absorbed in a film we never see. Attention comes off
 * the screen and onto the visitor, and by the end the room is quietly looking
 * back. Then, over that same held frame, the site says its last line and
 * offers its one action. There is no footer *after* the audience: the
 * audience is the footer.
 *
 * ## One video, not four plates
 *
 * The turn used to be four separate generations of the same staged audience,
 * cut between under a dip of the projector's light, because the plates drift
 * everywhere against one another (2→3 and 3→4 differ by a mean of 21–26/255
 * with no column or row below ~10) and therefore cannot be blended, masked or
 * seamed at any softness without a permanent double exposure. The dip existed
 * only to hide that: it bought a dark gap to change plate inside.
 *
 * The turn is now a continuous video generation, so none of that machinery is
 * needed. The motion is in the asset. The page's job shrinks to four things,
 * and it should not do a fifth:
 *
 *   1. Start it once, when the visitor reaches the audience.
 *   2. Never loop it.
 *   3. Hold the last frame while the closing copy resolves over it.
 *   4. Never show a gap — black, white, or empty — around any of that.
 *
 * No cover, no mask, no blur, no crossfade, no projector blackout. Anything
 * added on top of a video that already contains the performance is an
 * artefact laid over artwork.
 *
 * ## Holding the last frame
 *
 * A `<video>` with no `loop` holds its final frame after `ended` — that is the
 * primary mechanism, and it costs nothing. The still underneath is the
 * insurance, for the cases where it is not enough: the asset never loads, the
 * decoder is dropped on a backgrounded tab, or an autoplay policy refuses a
 * muted inline video anyway. Two stills are mounted, and exactly one is lit:
 *
 *   - the *open* still before the video ends. This is the video own first
 *     frame, extracted from it (`audience-turn-poster.jpg`), not one of the
 *     footer plates: the plates are graded differently from the generation, so
 *     plate 1 sits a measured 13.1/255 away from frame 0 with identical poses,
 *     and using it would pop the exposure at the moment the video is revealed.
 *     Extracted, that distance is 1.4/255 — JPEG noise.
 *   - the *final* still once it ends (or fails) — the audience as the video
 *     closes, so what the copy resolves over is the settled, fully-turned room
 *     either way. Footer plate 4 measures 2.6/255 from the video last frame,
 *     so the existing artwork already is that state and no second extract is
 *     warranted.
 *
 * The video itself stays transparent until it actually has a frame to show
 * (`data-video="ready"`, written on `loadeddata`), which is what keeps a
 * browser that paints an unpainted video element black from doing it here.
 *
 * "Fails" has to include the case where no source is usable at all — a 404, or
 * a Chromium built without H.264. That one does not surface on the video
 * element; see `useAudienceTurn`.
 *
 * ## Why the scroll engine rather than an observer
 *
 * Playback needs one boolean — has the visitor reached the audience — and the
 * shared engine already measures this scene every frame for `--p`. Taking the
 * answer from there costs one comparison inside a pass that was happening
 * anyway, where an IntersectionObserver would be a second, independently
 * timed source of truth about the same element. Nothing here runs per frame in
 * JavaScript beyond that comparison, and no React state is written per frame,
 * or at all.
 */

/**
 * The turn. Only the H.264 MP4 ships, so that is the only source declared: an
 * entry for a WebM that does not exist would resolve to a 404 on every load,
 * for every visitor, forever. If a WebM is added later, put it *before* the
 * MP4 so the browsers that take it never fetch both.
 */
export const AUDIENCE_VIDEO = [{ src: "/studios/audience-turn.mp4", type: "video/mp4" }] as const;

/**
 * Scene progress at which the turn starts, and the progress it must fall back
 * below — having also left the stage — before it is rewound.
 *
 * These are deliberately not the same number. A single threshold would let a
 * visitor resting their scroll on it restart the video on every small jitter;
 * the gap between them is the hysteresis that makes that impossible, and the
 * `onStage` term means even crossing it is not enough — the audience has to be
 * off screen entirely, which on this page means scrolled back up out of the
 * last act. Scrolling *within* the audience never restarts anything, and
 * scrolling back while the turn is still running leaves it running: it is
 * allowed to finish, because a half-turned room is not a state the artwork has.
 */
export const PLAY_AT = 0.06;
export const RESET_AT = 0.02;

/** Scene progress over which the closing copy resolves over the held frame. */
export const CLOSE = { from: 0.8, to: 0.9 } as const;

/**
 * Start the turn once, hold its end, and rewind only on a clean exit.
 *
 * `state` is the only thing CSS reads: absent while the room is still turning,
 * `"ended"` once it has settled — by finishing, by failing to load, or by
 * having playback refused. All three resolve to the same picture, which is the
 * point: the closing copy always lands on an audience that is looking back.
 */
function useAudienceTurn(rootRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    const element = document.getElementById("audience");
    const video = root?.querySelector<HTMLVideoElement>(".cw-aud__video");
    if (!root || !element || !video) return;

    // Set from script as well as markup: a muted autoplay is only permitted if
    // the element is muted at the moment play() is called, and React has
    // historically dropped the attribute on hydration.
    video.muted = true;

    let started = false;

    const settle = () => {
      root.dataset.state = "ended";
    };
    const ready = () => {
      root.dataset.video = "ready";
    };

    const start = () => {
      started = true;
      try {
        // Older browsers return undefined rather than a promise.
        video.play()?.catch(settle);
      } catch {
        settle();
      }
    };

    video.addEventListener("loadeddata", ready);
    video.addEventListener("ended", settle);
    // Fires for a decode failure once a source has been chosen.
    video.addEventListener("error", settle);
    // ...but NOT when no source can be used at all. With `<source>` children a
    // browser that rejects every candidate — a 404, or a build without the
    // codec — fires `error` on the last <source> element and leaves the video
    // element itself silent, with networkState NO_SOURCE. Without this the
    // footer would hold the *opening* still, the room still facing the screen,
    // under closing copy that reads as though it had turned. Sources are tried
    // in order, so an error on the last one means every one has failed;
    // an earlier source failing while a later one plays never reaches here.
    const sources = root.querySelectorAll("source");
    const last = sources[sources.length - 1];
    last?.addEventListener("error", settle);
    // The listener alone is not enough. The video is server-rendered, so the
    // browser runs resource selection while parsing the HTML — it can have
    // failed and fired long before React hydrates and this effect attaches.
    // NO_SOURCE is only reached once selection has concluded with nothing
    // usable, so reading it here catches exactly the case the listener missed.
    if (video.networkState === video.NETWORK_NO_SOURCE) settle();
    // A cached asset can be ready before this effect runs.
    if (video.readyState >= 2) ready();

    const stop = registerScene({
      element,
      apply(progress, onStage) {
        if (!started) {
          if (onStage && progress >= PLAY_AT) start();
          return;
        }
        if (!onStage && progress <= RESET_AT) {
          started = false;
          video.pause();
          video.currentTime = 0;
          delete root.dataset.state;
        }
      },
    });

    return () => {
      stop();
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("ended", settle);
      video.removeEventListener("error", settle);
      last?.removeEventListener("error", settle);
      video.pause();
    };
  }, [rootRef]);
}

/**
 * The audience frame: the stills, the turn, and the grade over both.
 *
 * Shared by the cinematic and reduced-motion paths so there is one composition
 * and one crop, and the only difference between the modes is whether a video
 * is mounted in it at all.
 */
function Frame({ video }: { video?: boolean }) {
  return (
    <div className="cw-aud__frame" aria-hidden="true">
      {video ? <div className="cw-aud__still" data-still="open" /> : null}
      <div className="cw-aud__still" data-still="final" />
      {video ? (
        <video
          className="cw-aud__video"
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
        >
          {AUDIENCE_VIDEO.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      ) : null}
      <div className="cw-aud__grade" />
    </div>
  );
}

/**
 * The closing copy, over the held frame. Shared by both modes so the reduced-
 * motion page ends on exactly the same words and the same action.
 *
 * A `<footer>` with an explicit `contentinfo` role: the cinematic path mounts
 * it inside `<main>`, where a bare `<footer>` would carry no landmark role,
 * and the site's last action and note should stay reachable by landmark
 * navigation exactly as the standalone footer they replace was.
 */
function Close({ children }: { children?: ReactNode }) {
  return (
    <footer className="cw-aud__close" role="contentinfo" aria-label="Channelwright Studios">
      <div className="cw-shell cw-aud__close-grid">
        <div className="cw-aud__close-main">
          <p className="cw-mono cw-mono--signal">Channelwright Studios</p>
          <p className="cw-aud__line">{FOOTER.line}</p>
          <Link className="cw-cta cw-cta--solid cw-aud__cta" href="/login">
            {OPEN.primaryCta}
          </Link>
        </div>
        <p className="cw-aud__note">{FOOTER.note}</p>
      </div>
      {children}
    </footer>
  );
}

export function AudienceFooter() {
  const rootRef = useRef<HTMLDivElement>(null);
  useAudienceTurn(rootRef);

  return (
    <Scene
      id="audience"
      travel={6.5}
      label="The audience"
      className="cw-scene--audience"
      revealAt={CLOSE.from}
    >
      <div className="cw-aud" aria-hidden="true" ref={rootRef}>
        <Frame video />
      </div>
      {/* Resolves only once the room has been looking back for a while: the
          visitor gets the moment before they get the message. */}
      <Cue from={CLOSE.from} to={CLOSE.to} className="cw-aud__close-cue">
        <Close />
      </Cue>
    </Scene>
  );
}

/**
 * The reduced-motion audience.
 *
 * Not the turn stopped part-way, and not the artwork withheld: the state the
 * video was travelling towards, held still, with the same closing copy over
 * it. No video element is mounted at all — not merely left unplayed — so
 * nothing is fetched or decoded for a visitor who has asked for less motion.
 * They still get the photograph, the glasses, the stare and the last line.
 */
export function AudienceFooterStatic() {
  return (
    <div className="cw-aud cw-aud--static" data-state="ended">
      <Frame />
      <Close />
    </div>
  );
}
