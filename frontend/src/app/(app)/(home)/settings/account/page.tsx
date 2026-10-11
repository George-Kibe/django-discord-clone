import type { Metadata } from "next";

import { AccountSettings } from "./account-settings";

export const metadata: Metadata = { title: "Account settings" };

export default function AccountSettingsPage() {
  return <AccountSettings />;
}
