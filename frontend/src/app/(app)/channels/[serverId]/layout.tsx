import { ServerLayout } from "./server-layout";

export default function Layout({ children }: LayoutProps<"/channels/[serverId]">) {
  return <ServerLayout>{children}</ServerLayout>;
}
