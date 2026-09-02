"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback } from "react";
import LandingHero from "@/components/LandingHero";

// MapView pulls in MapLibre GL JS (~220 KB gz) — lazy to keep the landing fast.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <LandingHero onStart={() => {}} onTown={() => {}} />,
});

function ClientHome() {
  const [showMap, setShowMap] = useState(false);
  const [mapKey, setMapKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("scan") || params.has("bbox")) {
      setShowMap(true);
      setMapKey((k) => k + 1);
    }
  }, []);

  // Town button: rewrite URL (no reload), open the map, force remount so the
  // auto-run effect inside MapView re-reads the new ?scan= param.
  const handleTown = useCallback((bbox: [number, number, number, number]) => {
    const q = `?scan=${bbox.map((n) => n.toFixed(5)).join(",")}`;
    window.history.replaceState({}, "", `/${q}`);
    setShowMap(true);
    setMapKey((k) => k + 1);
  }, []);

  return (
    <main className="relative flex h-dvh w-screen flex-col md:flex-row">
      {!showMap ? (
        <LandingHero onStart={() => setShowMap(true)} onTown={handleTown} />
      ) : (
        <MapView key={mapKey} autoRunParam={true} />
      )}
    </main>
  );
}

export default function Home() {
  return <ClientHome />;
}
