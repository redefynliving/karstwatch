import type { Metadata } from "next";
import { Mulish, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "KarstWatch — Sinkhole check for Bloomington",
  description:
    "Check land around Bloomington for sinkhole risk. Free public data, no account needed.",
  themeColor: "#2e7d5b",
  viewport: "width=device-width, initial-scale=1",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KarstWatch",
  },
  icons: [
    { rel: "icon", sizes: "192x192", url: "/icon-192.png" },
    { rel: "apple-touch-icon", sizes: "192x192", url: "/icon-192.png" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mulish.variable} ${plexMono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  );
}
