import type { Metadata } from "next";
import StudiosExperience from "@/features/studios/experience";

/**
 * Preview surface for the Channelwright Studios redesign.
 *
 * Deliberately isolated from "/" so the production homepage keeps working
 * unchanged while this experience is reviewed. Excluded from indexing until a
 * switch-over is decided explicitly.
 */
export const metadata: Metadata = {
  title: "Studios preview",
  description:
    "Channelwright Studios — the AI operating system for building and running a YouTube media business.",
  robots: { index: false, follow: false },
};

export default function StudiosPreviewPage() {
  return <StudiosExperience />;
}
