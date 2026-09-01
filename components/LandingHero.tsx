"use client";

/**
 * LandingHero — the page users see while MapLibre lazy-loads.
 * Replaces the blank screen + disabled button with: value prop + a real
 * topographic visualization (inline SVG, no asset weight) + a single CTA.
 */

function HeroSvg() {
  return (
    <svg viewBox="0 0 800 600" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e8efe6" />
          <stop offset="100%" stopColor="#cfd6c8" />
        </linearGradient>
        <pattern id="contour" patternUnits="userSpaceOnUse" width="800" height="600">
          {Array.from({ length: 12 }).map((_, i) => (
            <path
              key={i}
              d={`M0 ${50 + i * 50} Q200 ${20 + i * 50} 400 ${80 + i * 50} T800 ${30 + i * 50}`}
              fill="none"
              stroke={i % 2 ? "#a8b09c" : "#bcc4ad"}
              strokeWidth={1.2}
              opacity={0.5}
            />
          ))}
        </pattern>
        <radialGradient id="sink" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#b3402e" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#c96a2e" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#c96a2e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="url(#sky)" />
      <rect width="800" height="600" fill="url(#contour)" />
      {/* Sample depressions */}
      <circle cx="200" cy="200" r="50" fill="url(#sink)" />
      <circle cx="200" cy="200" r="14" fill="#b3402e" stroke="#fff" strokeWidth="2" />
      <circle cx="540" cy="350" r="36" fill="url(#sink)" />
      <circle cx="540" cy="350" r="9" fill="#c96a2e" stroke="#fff" strokeWidth="2" />
      <circle cx="640" cy="170" r="24" fill="url(#sink)" />
      <circle cx="640" cy="170" r="6" fill="#8fa32e" stroke="#fff" strokeWidth="1.5" />
      {/* A scan bbox to show the interaction */}
      <rect x="120" y="100" width="560" height="360" fill="none" stroke="#2e7d5b" strokeWidth="2" strokeDasharray="6 4" />
      <text x="130" y="92" fill="#2e7d5b" fontSize="12" fontWeight="700">Scan area</text>
    </svg>
  );
}

export default function LandingHero({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative flex h-dvh w-screen items-center justify-center overflow-hidden bg-kw-bg">
      <div className="absolute inset-0 -z-10 opacity-90">
        <HeroSvg />
        <div className="absolute inset-0 bg-gradient-to-b from-kw-bg/40 via-transparent to-kw-bg/60" />
      </div>

      <div className="w-full max-w-lg space-y-4 px-6 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-kw-ink">
          Sinkhole risk, checked in 60 seconds.
        </h1>
        <p className="text-sm leading-relaxed text-kw-muted">
          Draw a box around any property near Bloomington and KarstWatch scans
          free public elevation data (USGS), karst geology (IGS), soil surveys
          (SSURGO), and floodplains (FEMA). No account. No credit card. Results
          in seconds.
        </p>

        <ul className="flex flex-col gap-1.5 text-left text-xs text-kw-muted">
          <li className="flex items-start gap-2">
            <span className="text-emerald-600">✓</span>
            <span>Dip detection, confidence scoring, risk level</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-600">✓</span>
            <span>Groundwater vulnerability + well-water test cadence</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-600">✓</span>
            <span>Insurance signal + elevation time-lapse</span>
          </li>
        </ul>

        <button
          onClick={onStart}
          className="kw-cta mt-2 w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-white"
        >
          Check my property
        </button>

        {/* One-tap scan for known karst towns — removes the "draw area" friction
            for the most common case. Each bboxes a 0.04° area centered on the town. */}
        <div className="mt-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-kw-muted">
            Or scan a known karst area
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {[
              { name: "Bloomington", lng: -86.5264, lat: 39.1653 },
              { name: "Ellettsville", lng: -86.6219, lat: 39.2339 },
              { name: "Solsberry", lng: -86.7550, lat: 39.0844 },
              { name: "Stanford", lng: -86.6664, lat: 39.1433 },
              { name: "Clear Creek", lng: -86.5400, lat: 39.1097 },
              { name: "Harrodsburg", lng: -86.5456, lat: 39.0164 },
            ].map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  const half = 0.02;
                  const bbox: [number, number, number, number] = [
                    t.lng - half, t.lat - half, t.lng + half, t.lat + half,
                  ];
                  window.history.replaceState({}, "",
                    `/?scan=${bbox.map((n) => n.toFixed(5)).join(",")}`);
                  // Force page reload so the new URL triggers auto-run
                  window.location.reload();
                }}
                className="rounded-md border border-kw-line bg-white px-2 py-1.5 text-xs font-semibold text-kw-ink hover:bg-kw-soft"
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-kw-muted/80">
          Already have a link? Open it directly — scans are sharable.
        </p>
      </div>
    </div>
  );
}
