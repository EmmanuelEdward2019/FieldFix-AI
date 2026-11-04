const FAULTS = [
  "No power",
  "Cracked display",
  "Overheating",
  "Swollen battery",
  "Boot loop",
  "Dead touch",
  "No charge",
  "GPU artifacts",
  "Water damage",
  "Faulty keyboard",
];

/** Infinite ticker of faults FieldFix helps diagnose. Decorative. */
export function FaultTicker() {
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {FAULTS.map((fault) => (
        <span key={fault} className="flex items-center">
          <span className="rounded-full border border-edge bg-panel px-3 py-1 text-xs whitespace-nowrap text-slate-300">
            {fault}
          </span>
          <span className="mx-3 size-1 shrink-0 rounded-full bg-cyan-400/60" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="overflow-hidden border-y border-edge bg-panel/60 py-3" aria-hidden>
      <div className="flex w-max animate-ticker">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
