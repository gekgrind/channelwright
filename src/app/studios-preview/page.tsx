import { redirect } from "next/navigation";

// Temporary while existing preview links move to the public homepage.
export default function StudiosPreviewPage() {
  redirect("/");
}
