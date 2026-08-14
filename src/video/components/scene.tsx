import { AbsoluteFill, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { RenderScene } from "../schemas/render-input";

const palettes = [
  ["#07111f", "#102a43", "#2dd4bf"],
  ["#120b2f", "#312e81", "#a78bfa"],
  ["#071a16", "#115e59", "#5eead4"],
  ["#241006", "#7c2d12", "#fb923c"],
] as const;

export function Scene({ scene, sceneIndex, durationInFrames }: { scene: RenderScene; sceneIndex: number; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const palette = palettes[sceneIndex % palettes.length];
  const fadeFrames = Math.min(10, Math.floor(durationInFrames / 3));
  const opacity = interpolate(
    frame,
    [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames - 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const translateY = interpolate(frame, [0, Math.max(1, fadeFrames)], [36, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const isTitle = scene.role === "TITLE";
  const isCta = scene.role === "CTA";
  const visual = scene.assetReferences[0];
  const visualSource = visual?.reference.startsWith("synthetic://") ? undefined
    : visual?.reference.startsWith("public://") ? staticFile(visual.reference.slice("public://".length))
      : visual?.reference;

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        color: "#f8fafc",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        background: `radial-gradient(circle at ${18 + progress * 18}% 24%, ${palette[2]}55 0, transparent 30%), linear-gradient(135deg, ${palette[0]} 0%, ${palette[1]} 100%)`,
      }}
    >
      <div style={{ position: "absolute", inset: 54, border: "1px solid rgba(255,255,255,0.16)", borderRadius: 34 }} />
      {visualSource ? <div style={{ position: "absolute", right: 90, top: 120, width: 620, height: 650, overflow: "hidden", borderRadius: 32, opacity: opacity * 0.72, boxShadow: "0 30px 90px rgba(0,0,0,.35)" }}>
        {visual.kind === "IMAGE" ? <Img src={visualSource} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <OffthreadVideo src={visualSource} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        <AbsoluteFill style={{ background: `linear-gradient(90deg, ${palette[0]} 0%, transparent 55%)` }} />
      </div> : null}
      <div
        style={{
          position: "absolute",
          width: 610,
          height: 610,
          right: -120 + progress * 80,
          top: -180 + progress * 60,
          border: `2px solid ${palette[2]}66`,
          borderRadius: "50%",
          boxShadow: `0 0 120px ${palette[2]}33`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 130,
          right: isTitle || isCta ? 130 : visualSource ? 760 : 610,
          top: isTitle || isCta ? 210 : 170,
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div style={{ color: palette[2], fontSize: 25, fontWeight: 800, letterSpacing: 5, marginBottom: 28 }}>
          {scene.eyebrow ?? `SCENE ${String(sceneIndex + 1).padStart(2, "0")}`}
        </div>
        <h1 style={{ fontSize: isTitle ? 104 : isCta ? 88 : 78, lineHeight: 1.02, letterSpacing: -4, margin: 0, maxWidth: 1480 }}>
          {scene.headline}
        </h1>
        <p style={{ color: "#dbeafe", fontSize: 34, lineHeight: 1.42, margin: "34px 0 0", maxWidth: 1250 }}>
          {scene.body}
        </p>
      </div>

      {!isTitle && !isCta ? (
        <div style={{ position: "absolute", right: 130, top: 255, width: 360, height: 360, opacity }}>
          {[0, 1, 2].map((ring) => (
            <div
              key={ring}
              style={{
                position: "absolute",
                inset: ring * 52,
                border: `3px solid ${palette[2]}${ring === 0 ? "aa" : "66"}`,
                borderRadius: ring % 2 === 0 ? 46 : "50%",
                transform: `rotate(${progress * (ring % 2 === 0 ? 24 : -28)}deg)`,
              }}
            />
          ))}
          <div style={{ position: "absolute", inset: 140, background: palette[2], borderRadius: 24, boxShadow: `0 0 55px ${palette[2]}` }} />
        </div>
      ) : null}

      <div style={{ position: "absolute", left: 130, right: 130, bottom: 82, display: "flex", justifyContent: "space-between", color: "#93c5fd", fontSize: 21, letterSpacing: 2 }}>
        <span>CHANNELWRIGHT</span>
        <span>{String(sceneIndex + 1).padStart(2, "0")} / LOCAL RENDER</span>
      </div>
    </AbsoluteFill>
  );
}
