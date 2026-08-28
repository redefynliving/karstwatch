import { RiskResult } from '@/lib/risk'
import { GwResult } from '@/lib/groundwater'

const BADGE = {
  CRITICAL: 'bg-red-600 text-white border-red-700',
  HIGH: 'bg-orange-500 text-white border-orange-600',
  MEDIUM: 'bg-amber-400 text-stone-900 border-amber-500',
  LOW: 'bg-emerald-600 text-white border-emerald-700',
} as const

const GW_BADGE = {
  CRITICAL: 'bg-slate-900 text-white',
  HIGH: 'bg-orange-600 text-white',
  MODERATE: 'bg-amber-400 text-stone-900',
  LOW: 'bg-emerald-600 text-white',
} as const

function Bar({ score }: { score: number }) {
  const pct = Math.max(4, Math.min(100, score));
  const color = score >= 75 ? 'bg-red-600' : score >= 55 ? 'bg-orange-500' : score >= 32 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="h-2 w-full rounded-full bg-stone-200 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function RiskPanel({ riskResult, gwResult }: { riskResult: RiskResult | null; gwResult?: GwResult | null }) {
  if (!riskResult && !gwResult) return null;

  return (
    <div className="space-y-3 mt-3">
      {/* Karst risk — big, scannable */}
      {riskResult && (
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold tracking-wide text-stone-800">Karst risk</h3>
            <span className={`rounded-full border px-3 py-1 text-xs font-extrabold tracking-wider ${BADGE[riskResult.risk]}`}>{riskResult.risk}</span>
          </div>
          <div className="mt-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-stone-900">{Math.round(riskResult.score * 100)}</span>
              <span className="text-sm text-stone-500">/ 100</span>
            </div>
            <div className="mt-2"><Bar score={Math.round(riskResult.score*100)} /></div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-stone-700">{riskResult.recommendation}</p>

          {/* Plain-English factors */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-stone-50 p-2 border border-stone-100">
              <div className="text-stone-500">Dips found</div>
              <div className="text-sm font-bold text-stone-900">{riskResult.factors.dipCount} <span className="font-normal text-stone-500">avg {riskResult.factors.avgDepthM} m</span></div>
              <div className="text-[11px] text-stone-500">{riskResult.factors.likelyCount} likely • {riskResult.factors.uncertainCount} uncertain</div>
            </div>
            <div className="rounded-lg bg-stone-50 p-2 border border-stone-100">
              <div className="text-stone-500">Nearest sinkhole</div>
              <div className="text-sm font-bold text-stone-900">{riskResult.factors.nearestSinkholeKm !== null ? `${riskResult.factors.nearestSinkholeKm.toFixed(1)} km` : '—'}</div>
              <div className="text-[11px] text-stone-500">{riskResult.factors.bedrockKarst ? 'Limestone bedrock ✓' : 'No limestone detected'}</div>
            </div>
          </div>

          <details className="mt-3 rounded-lg bg-stone-50 border border-stone-200 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-stone-700">Show details</summary>
            <div className="mt-2 space-y-1 text-xs text-stone-600">
              <p>Karst zone overlap: <b className="text-stone-800">{riskResult.factors.karstZoneOverlap}%</b></p>
              <p>Nearest cave: <b className="text-stone-800">{riskResult.factors.nearestCaveKm !== null ? `${riskResult.factors.nearestCaveKm.toFixed(1)} km` : '—'}</b></p>
              <p>Max depth: <b className="text-stone-800">{riskResult.factors.maxDepthM} m</b></p>
            </div>
          </details>
        </div>
      )}

      {/* Groundwater vulnerability — second card, easy to read */}
      {gwResult && (
        <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold tracking-wide text-sky-900">Groundwater vulnerability</h3>
            <span className={`rounded-full px-3 py-1 text-xs font-extrabold tracking-wider ${GW_BADGE[gwResult.level]}`}>{gwResult.level}</span>
          </div>
          <div className="mt-1 text-xs font-semibold text-sky-800">{gwResult.label}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-black text-sky-950">{gwResult.score}</span>
            <span className="text-xs text-sky-700">/ 100</span>
          </div>
          <div className="mt-2"><Bar score={gwResult.score} /></div>
          <p className="mt-3 text-sm leading-relaxed text-stone-700">{gwResult.why}</p>

          <div className="mt-3 rounded-lg bg-white border border-sky-100 p-2">
            <div className="text-[11px] font-bold tracking-wider text-sky-800 uppercase">What drives it</div>
            <ul className="mt-1 space-y-1 text-xs text-stone-700">
              {gwResult.breakdown.map(b => (
                <li key={b.name} className="flex justify-between gap-2">
                  <span>{b.name} <span className="text-stone-400">— {b.note}</span></span>
                  <span className="font-semibold text-stone-800">{Math.round(b.value*100)}%</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
            Tip: Wells downhill from sinkholes + septic on sandy/clay-mixed soil = higher well-water risk. Keep septic &gt;100 ft from known karst features.
          </p>
        </div>
      )}
    </div>
  );
}
