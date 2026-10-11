import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-8 md:grid-cols-[160px_1fr]">
      <SettingsNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
