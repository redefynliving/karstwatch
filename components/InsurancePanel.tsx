"use client";

import type { InsResult } from "@/lib/insurance";

const BADGE = {
  LOW: "bg-emerald-600 text-white border-emerald-700",
  MODERATE: "bg-amber-400 text-stone-900 border-amber-500",
  ELEVATED: "bg-orange-500 text-white border-orange-600",
  HIGH: "bg-red-600 text-white border-red-700",
} as const;

function Bar({ score }: { score: number }) {
  const pct = Math.max(4, Math.min(100, score));
  const color =
    score >= 70 ? "bg-red-600" : score >= 45 ? "bg-orange-500" : score >= 22 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="h-2 w-full rounded-full bg-stone-200 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function InsurancePanel({ ins }: { ins: InsResult | null }) {
  if (!ins) return null;

  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-violet-900">Insurance signal</h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-extrabold tracking-wider ${BADGE[ins.level]}`}>
          {ins.level}
        </span>
      </div>
      <div className="mt-1 text-xs font-semibold text-violet-800">{ins.headline}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-black text-violet-950">{ins.score}</span>
        <span className="text-xs text-violet-700">/ 100 (not a quote)</span>
      </div>
      <div className="mt-2">
        <Bar score={ins.score} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-stone-700">{ins.reason}</p>

      <div className="mt-3 rounded-lg bg-white border border-violet-100 p-2">
        <div className="text-[11px] font-bold tracking-wider text-violet-800 uppercase">What insurers actually ask</div>
        <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-stone-700">
          {ins.whatInsurersAsk.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>

      <div className="mt-2 rounded-lg bg-white border border-violet-100 p-2">
        <div className="text-[11px] font-bold tracking-wider text-violet-800 uppercase">What lowers your risk</div>
        <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-stone-700">
          {ins.whatToDo.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
        Caveat: this is a transparent proxy from public data, not an underwriting decision. Real pricing depends on your carrier, claim history, and an in-person inspection.
      </p>
    </div>
  );
}