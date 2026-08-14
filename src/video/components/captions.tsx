import { useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderInput } from "../schemas/render-input";

export function Captions({ captions }: Pick<RenderInput, "captions">) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activeCaption = captions.find((caption) => frame >= Math.floor(caption.startSeconds * fps) && frame < Math.ceil(caption.endSeconds * fps));

  if (!activeCaption) return null;

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 20,
        left: "50%",
        bottom: 122,
        transform: "translateX(-50%)",
        maxWidth: 1400,
        padding: "15px 28px 18px",
        borderRadius: 18,
        color: "white",
        background: "rgba(2, 6, 23, 0.86)",
        boxShadow: "0 12px 50px rgba(0, 0, 0, 0.35)",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 37,
        fontWeight: 750,
        lineHeight: 1.22,
        textAlign: "center",
      }}
    >
      {activeCaption.text}
    </div>
  );
}
