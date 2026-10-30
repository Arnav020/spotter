import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Spotter: a second pair of eyes for hands-on work",
  description:
    "Point any camera at a hands-on task. Spotter checks every step against a verified procedure in real time, using NVIDIA Nemotron on Nebius Token Factory.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
