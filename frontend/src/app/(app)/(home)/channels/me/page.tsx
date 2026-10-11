import type { Metadata } from "next";

import { Welcome } from "./welcome";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return <Welcome />;
}
