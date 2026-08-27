import { RiskResult } from '@/lib/risk'

const BADGE_STYLES = {
  CRITICAL: 'bg-red-600 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-amber-400 text-kw-ink',
  LOW: 'bg-green-500 text-white',
} as const

export default function RiskPanel({ riskResult }: { riskResult: RiskResult | null }) {
  if (!riskResult) return null

  const { score, risk, factors, recommendation } = riskResult
  const badge = BADGE_STYLES[risk]

  return (
    <div className="kw-card mt-3 p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-kw-muted">
          Karst risk assessment
        </h3>
        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${badge}`}>
          {risk}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-kw-ink mb-2">{recommendation}</p>
      <details className="border-t border-kw-border pt-2 text-[11px] text-kw-muted">
        <summary className="cursor-pointer font-medium text-kw-ink">
          Score {Math.round(score * 100)}% — factors
        </summary>
        <div className="mt-1 space-y-1 text-[11px]">
          <p>Dips detected: <b className="text-kw-ink">{factors.dipCount}</b>
            (avg depth {factors.avgDepthM} m, max {factors.maxDepthM} m)</p>
          <p>Likely sinkholes: <b className="text-green-700">{factors.likelyCount}</b>
            · Uncertain: <b className="text-amber-700">{factors.uncertainCount}</b></p>
          {factors.bedrockKarst && (
            <p>Karst bedrock present: <span className="text-kw-accent">limestone/dolomite</span></p>
          )}
          {factors.nearestSinkholeKm !== null && (
            <p>Nearest verified sinkhole: <b className="text-kw-ink">{factors.nearestSinkholeKm.toFixed(1)} km</b></p>
          )}
          {factors.karstZoneOverlap > 0 && (
            <p>Area over known karst zones: <b className="text-kw-ink">{factors.karstZoneOverlap}%</b></p>
          )}
        </div>
      </details>
    </div>
  )
}
