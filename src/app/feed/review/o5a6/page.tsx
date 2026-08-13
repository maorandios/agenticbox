import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/require-user";
import { O5a62ReviewPage } from "@/components/feed/O5a62ReviewPage";

export default async function O5a62ReviewRoutePage() {
  if (process.env.NODE_ENV === "production") {
    redirect("/feed");
  }
  const { user } = await requireUser();
  if (!user) redirect("/login?next=/feed/review/o5a6");
  return <O5a62ReviewPage />;
}
