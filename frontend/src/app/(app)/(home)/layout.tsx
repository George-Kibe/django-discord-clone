import { HomeSidebar } from "./home-sidebar";

export default function HomeLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <HomeSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
