import { requireUser } from "@/server/auth";
import StudioApp from "@/features/studio/studio-app";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const user = await requireUser();
  return <StudioApp user={{ email: user.email, mode: user.mode }} />;
}
