import type { Metadata } from "next";
import StudiosExperience from "@/features/studios/experience";

export const metadata: Metadata = {
  title: "Channelwright Studios",
  description:
    "The AI operating system for building and running a profitable YouTube media business. Evidence before strategy, strategy before production, and a human decision at every gate.",
  alternates: { canonical: "https://channelwright.entrepreneuria.io/" },
};

export default function HomePage() {
  return <StudiosExperience />;
}
