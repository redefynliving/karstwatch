import MapView from "@/components/MapView";

export default function Home() {
  // relative so the mobile bottom-sheet can position over the map
  return (
    <main className="relative flex h-dvh w-screen flex-col md:flex-row">
      <MapView />
    </main>
  );
}
