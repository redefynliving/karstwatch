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
    "Check your land for sinkhole risk in Monroe County, Indiana. Free public data, no account needed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mulish.variable} ${plexMono.variable}`}>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  );
}
