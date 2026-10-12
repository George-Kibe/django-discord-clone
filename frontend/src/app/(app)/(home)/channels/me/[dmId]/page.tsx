import type { Metadata } from "next";

import { DMPage } from "@/features/dms/components/dm-page";

export const metadata: Metadata = { title: "Direct message" };

export default function Page() {
  return <DMPage />;
}
