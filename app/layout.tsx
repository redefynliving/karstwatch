import type { Metadata } from "next";
import { Mulish, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const mulish = Mulish({ subsets: ["latin"], variable: "--font-mulish" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "KarstWatch — Sinkhole check for Bloomington, Indiana",
  description:
    "Draw a box around any property near Bloomington and KarstWatch scans free public elevation, karst geology, and soil data to find sinkhole-shaped depressions. No account, no credit card.",
  keywords: [
    "sinkhole risk", "karst", "Bloomington Indiana", "Monroe County",
    "subsidence", "well water", "insurance", "floodplain", "USGS",
  ],
  openGraph: {
    title: "KarstWatch — Sinkhole check for Bloomington",
    description: "Free sinkhole risk scan for Bloomington / Monroe County. No account needed.",
    type: "website",
  },
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

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "KarstWatch",
  alternateName: "KarstWatch — Bloomington sinkhole risk",
  url: "https://karstwatch.vercel.app",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any (browser)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description:
    "Free sinkhole-risk monitoring for Bloomington / Monroe County, Indiana. Uses USGS elevation, Indiana Geological Survey karst data, SSURGO soils, and FEMA floodplains. No account, no credit card.",
  areaServed: {
    "@type": "City",
    name: "Bloomington",
    containedInPlace: { "@type": "State", name: "Indiana" },
  },
  featureList: [
    "Elevation-based depression detection",
    "Karst zone overlap + bedrock lithology scoring",
    "Groundwater vulnerability (DRASTIC-lite)",
    "Private well water test cadence",
    "Insurance signal (sinkhole-claim proxy)",
    "Elevation time-lapse (modern vs older DEM)",
    "Real Sentinel-1 SAR acquisition lookup",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mulish.variable} ${plexMono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <Script id="kw-jsonld" type="application/ld+json" strategy="beforeInteractive">
          {JSON.stringify(JSON_LD)}
        </Script>
      </head>
      <body className="h-full font-sans antialiased">{children}</body>
    </html>
  );
}
