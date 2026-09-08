import type { Metadata } from "next";
import AudienceProof from "@/features/studios/audience-proof/audience-proof";

export const metadata: Metadata = {
  title: "Audience attention proof",
  description: "An isolated two-person attention-transfer experiment.",
  robots: { index: false, follow: false },
};

export default function AudienceProofPage() {
  return <AudienceProof />;
}
