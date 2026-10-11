import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Discord Clone",
    template: "%s · Discord Clone",
  },
  description: "Real-time chat with servers, channels, roles and direct messages.",
};

export const viewport: Viewport = {
  themeColor: "#1e1f22",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark theme by default (NFR-UX-03); a theme switcher arrives with the app shell.
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
