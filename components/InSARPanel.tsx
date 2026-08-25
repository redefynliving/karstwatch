"use client";

interface Props {
  bbox: [number, number, number, number];
}

/**
 * Friendly entry point to ASF Vertex (free Sentinel-1 radar archive) for
 * the scanned area. Vertex requires a free NASA Earthdata account — that's
 * on their site, nothing to configure in this app.
 */
export default function InSARPanel({ bbox }: Props) {
  const [w, s, e, n] = bbox;
  const vertexUrl =
    `https://search.asf.alaska.edu/#/?results=true&dataset=SENTINEL-1` +
    `&zoom=9.00&center=${((w + e) / 2).toFixed(4)},${((n + s) / 2).toFixed(4)}` +
    `&polygon=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${s.toFixed(4)},` +
    `${e.toFixed(4)},${n.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${w.toFixed(4)},${s.toFixed(4)}`;

  return (
    <details className="mt-3 rounded-lg border border-kw-line bg-kw-bg p-3">
      <summary className="cursor-pointer text-sm font-medium text-kw-ink">
        Check if the ground is moving (advanced)
      </summary>
      <div className="mt-2 space-y-2 text-xs leading-relaxed text-kw-muted">
        <p>
          Satellites can measure tiny ground movements over time. This opens a
          free NASA tool (Earthdata login required — it's free) already pointed
          at your area.
        </p>
        <a
          href={vertexUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block font-medium text-kw-accent underline underline-offset-2 hover:brightness-90"
        >
          Open satellite check for this area →
        </a>
        <p>
          Look for rings of color that tighten over the years — that can mean
          sinking ground. Slow movement of a few millimeters a year is normal.
        </p>
      </div>
    </details>
  );
}
