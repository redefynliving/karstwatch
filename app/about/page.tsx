import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 pb-20 font-mono text-sm text-kw-ink">
      <h1 className="mb-2 text-3xl font-bold text-kw-emerald">About KarstWatch</h1>
      <p className="mb-6 text-kw-muted">
        Mapping the land around Bloomington, Indiana for the telltale bowl-shaped
        dips that sign­al sinkhole risk — using only free, public geodata, no account
        required.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">Data sources</h2>
        <ul className="space-y-1">
          <li>
            <b className="text-kw-ink">Elevation:</b> AWS Open Data "elevation-tiles-prod" —
            USGS 3DEP, read at zoom 15 for ~4.7 m resolution (falls back to ~10 m
            at zoom 13 for larger areas). We decode the red-green-blue pixels from
            the terrarium PNG tiles and turn them into ground heights with a
            priority-flood (fill-sinks) algorithm.
          </li>
          <li>
            <b className="text-kw-ink">Verified sinkholes:</b> Indiana Geological &amp; Water survey <i>Sinkhole Inventory</i> (155,000+ mapped points statewide — shown as amber dots you can toggle on).
          </li>
          <li>
            <b className="text-kw-ink">Mapped karst areas:</b> IGWS{" "}
            <i>Sinkhole Areas</i> layer — tan polygons, also toggleable.
          </li>
          <li>
            <b className="text-kw-ink">Springs:</b> IGWS springs dataset — blue dots.
          </li>
          <li>
            <b className="text-kw-ink">Basemap, hillshade, search:</b> CARTO, MapLibre,
            Nominatim — all free, no key.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">Accuracy</h2>
        <p className="mb-3">
          We scored KarstWatch against the IGWS <b>Sinkhole Inventory</b> — the state's
          official catalog of verified sinkholes — across four test areas around
          Bloomington (2 karst-heavy, 2 control):
        </p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-kw-border text-left">
              <th className="py-1.5">Area</th>
              <th className="py-1.5">Dips found</th>
              <th className="py-1.5">Verified sinkholes in area</th>
              <th className="py-1.5">Dips within 200 m of a verified sinkhole</th>
            </tr>
          </thead>
          <tbody className="text-kw-muted">
            <tr className="border-b border-kw-border/30"><td className="py-1.5">Lake Lemon area</td><td>313</td><td>2</td><td>0%</td></tr>
            <tr className="border-b border-kw-border/30"><td className="py-1.5">Harrodsburg / S. Bloomington</td><td>143</td><td>38</td><td>7%</td></tr>
            <tr className="border-b border-kw-border/30"><td className="py-1.5">IU campus (control)</td><td>3</td><td>0</td><td>0%</td></tr>
            <tr className="border-b border-kw-border/30"><td className="py-1.5">Lake Monroe (control)</td><td>22</td><td>0</td><td>0%</td></tr>
          </tbody>
        </table>
        <p className="mt-3">
          <b className="text-kw-ink">What this means:</b> 7% of our dips land near a
          verified sinkhole. That's intentionally low — our scanner finds{" "}
          <i>every bowl-shaped dip</i> in the terrain (bedrock hollows, old ponds,
          quarries, drainage, <i>and</i> unmapped sinkholes). The verified inventory
          is a sparse subset of what's actually shaped like a sinkhole. The real
          signal is <b>relative density</b>: karst-heavy areas produce ~10× more dips
          than control areas, and most of those dips cluster near known karst.
        </p>
        <p className="mt-2">
          <b>Resolution:</b> ~4.7 m per pixel (zoom 15) for small-to-medium areas,
          ~10 m (zoom 13) for larger scans. Features under ~10 m wide can be missed.
          Edges are approximate. This is for <b>triage and curiosity</b> — if a dip
          looks concerning, hire a local geotechnical engineer for a site visit.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-bold">Privacy & cost</h2>
        <p>
          Everything runs in your browser. Your drawn shape never touches a server.
          Elevation tiles are cached locally via a service worker so repeat scans
          don't re-download the same terrain. No cookies, no tracking, no ads.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">Open source</h2>
        <p>
          <a
            href="https://github.com/redefynliving/karstwatch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kw-emerald underline"
          >
            github.com/redefynliving/karstwatch
          </a>{" "}
          — built with{" "}
          <a
            href="https://maplibre.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kw-emerald underline"
          >
            MapLibre
          </a>
          ,{" "}
          <a
            href="https://aws.amazon.com/opendatasets/elevation-tiles/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-kw-emerald underline"
          >
            USGS 3DEP
          </a>
          , and the IGWS open data APIs. Contributions welcome.
        </p>
        <Link href="/" className="mt-4 inline-block text-kw-emerald underline">
          ← Back to the map
        </Link>
      </section>
    </main>
  );
}
