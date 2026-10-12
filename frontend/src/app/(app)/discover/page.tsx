import type { Metadata } from "next";

import { Discover } from "@/features/servers/components/discover";

export const metadata: Metadata = { title: "Discover servers" };

export default function DiscoverPage() {
  return <Discover />;
}
