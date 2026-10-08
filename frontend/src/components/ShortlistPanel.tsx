import { PLATFORM_LABEL, ShortlistItem } from "../types";
import { exportUrl, thumbUrl } from "../services/api";

interface Props {
  items: ShortlistItem[];
  onRemove: (key: string) => void;
  onClose: () => void;
}

export default function ShortlistPanel({ items, onRemove, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()} aria-label="Shortlist">
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">Shortlist ({items.length})</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </header>

        <div className="flex gap-2 px-5 py-3 border-b border-slate-100">
          <a href={exportUrl("csv")} className={`flex-1 text-center text-sm rounded-lg py-2 bg-brand-600 text-white hover:bg-brand-700 ${items.length ? "" : "pointer-events-none opacity-40"}`}>
            Export CSV
          </a>
          <a href={exportUrl("json")} className={`flex-1 text-center text-sm rounded-lg py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 ${items.length ? "" : "pointer-events-none opacity-40"}`}>
            Export JSON
          </a>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {!items.length && <li className="p-6 text-sm text-slate-400 text-center">Star videos (☆) to save them here.</li>}
          {items.map((i) => (
            <li key={i.key} className="flex gap-3 p-4">
              <div className="w-16 h-20 rounded bg-slate-100 overflow-hidden shrink-0">{i.thumbId && <img src={thumbUrl(i.thumbId)} alt="" className="w-full h-full object-cover" />}</div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400">
                  {PLATFORM_LABEL[i.platform]} {i.score !== undefined && <>· score {i.score}</>}
                </p>
                {i.productTitle && <p className="text-sm text-slate-700 truncate">{i.productTitle}</p>}
                {i.reason && <p className="text-xs text-slate-500 line-clamp-2">{i.reason}</p>}
                <div className="flex gap-3 mt-1 text-xs">
                  <a href={i.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                    Open
                  </a>
                  <button onClick={() => onRemove(i.key)} className="text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
