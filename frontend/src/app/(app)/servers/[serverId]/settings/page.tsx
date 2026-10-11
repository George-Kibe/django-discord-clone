import type { Metadata } from "next";

import { ServerSettings } from "./server-settings";

export const metadata: Metadata = { title: "Server settings" };

export default function ServerSettingsPage() {
  return <ServerSettings />;
}
