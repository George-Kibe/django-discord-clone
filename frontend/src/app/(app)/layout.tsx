import { AppShell } from "@/components/app/app-shell";

export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
