"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import LandingHero from "@/components/LandingHero";

// MapView pulls in MapLibre GL JS (~220 KB gz) — lazy to keep the landing fast.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <LandingHero onStart={() => {}} />,
});

function ClientHome() {
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("scan") || params.has("bbox")) setShowMap(true);
  }, []);

  return (
    <main className="relative flex h-dvh w-screen flex-col md:flex-row">
      {!showMap ? (
        <LandingHero onStart={() => setShowMap(true)} />
      ) : (
        <MapView autoRunParam={true} />
      )}
    </main>
  );
}

export default function Home() {
  return <ClientHome />;
}
