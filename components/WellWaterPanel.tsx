"use client";

import type { WellResult } from "@/lib/wellwater";

const BADGE = {
  EXCELLENT: "bg-emerald-600 text-white border-emerald-700",
  GOOD: "bg-emerald-500 text-white border-emerald-600",
  MONITOR: "bg-amber-400 text-stone-900 border-amber-500",
  TEST_YEARLY: "bg-orange-500 text-white border-orange-600",
  TEST_TWICE_YEARLY: "bg-red-600 text-white border-red-700",
} as const;

const LABEL = {
  EXCELLENT: "Excellent",
  GOOD: "Good protection",
  MONITOR: "Monitor",
  TEST_YEARLY: "Test yearly",
  TEST_TWICE_YEARLY: "Test twice yearly",
} as const;

function Bar({ score }: { score: number }) {
  const pct = Math.max(4, Math.min(100, score));
  const color =
    score >= 75
      ? "bg-red-600"
      : score >= 55
      ? "bg-orange-500"
      : score >= 32
      ? "bg-amber-400"
      : "bg-emerald-500";
  return (
    <div className="h-2 w-full rounded-full bg-stone-200 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function WellWaterPanel({ well }: { well: WellResult | null }) {
  if (!well) return null;

  return (
    <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold tracking-wide text-cyan-900">Well water</h3>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-extrabold tracking-wider ${BADGE[well.level]}`}
        >
          {LABEL[well.level]}
        </span>
      </div>
      <div className="mt-1 text-xs font-semibold text-cyan-800">{well.cadence}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-xl font-black text-cyan-950">{well.priority}</span>
        <span className="text-xs text-cyan-700">/ 100 risk priority</span>
      </div>
      <div className="mt-2">
        <Bar score={well.priority} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-stone-700">{well.reason}</p>

      <div className="mt-3 rounded-lg bg-white border border-cyan-100 p-2">
        <div className="text-[11px] font-bold tracking-wider text-cyan-800 uppercase">What to test for</div>
        <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-stone-700">
          {well.tests.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="mt-2 rounded-lg bg-white border border-cyan-100 p-2">
        <div className="text-[11px] font-bold tracking-wider text-cyan-800 uppercase">What to do</div>
        <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs text-stone-700">
          {well.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
        Tip: Your local health department often does free well-water test kits. Indiana: <a className="underline" href="https://www.in.gov/isdh/" target="_blank" rel="noreferrer">IN Dept of Health</a>.
      </p>
    </div>
  );
}