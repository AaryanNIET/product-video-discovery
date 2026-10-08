/** Mirrors SCORE_RUBRIC in backend/src/services/brain/matchScorer.ts so users know what a score means. */
export default function ScoreLegend({ threshold }: { threshold: number }) {
  const bands = [
    { range: "90-100", label: "Exact product", cls: "bg-emerald-600 text-white", rule: "logo, print, colours, shape and text all match" },
    { range: "70-89", label: "Very close", cls: "bg-emerald-100 text-emerald-800", rule: "same product, small details hidden" },
    { range: "40-69", label: "Same category", cls: "bg-amber-100 text-amber-800", rule: "similar, but a key detail differs" },
    { range: "0-39", label: "Different", cls: "bg-slate-200 text-slate-700", rule: "another product, or not visible" },
  ];
  return (
    <details className="bg-white border border-slate-200 rounded-xl p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-slate-700">How match scores work</summary>
      <p className="text-xs text-slate-500 mt-2">
        The image brain compares each video thumbnail with the product photo. Videos scoring <b>{threshold}+</b> count as verified; lower scores are hidden unless you turn on "Show below threshold".
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {bands.map((b) => (
          <li key={b.range} className="flex items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 w-14 text-center font-semibold ${b.cls}`}>{b.range}</span>
            <span className="text-slate-700 font-medium">{b.label}</span>
            <span className="text-slate-400">{b.rule}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
