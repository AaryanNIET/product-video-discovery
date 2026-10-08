import { DragEvent, FormEvent, useRef, useState } from "react";
import { fileToDataUrl } from "../services/api";

interface Props {
  onSearch: (body: { input: string; imageDataUrl?: string; includeTikTok: boolean }) => void;
  busy: boolean;
  tiktokAvailable: boolean;
}

const EXAMPLES = ["Stanley Quencher H2.0 tumbler", "oversized graphic tee", "protein dark chocolate"];

export default function SearchBar({ onSearch, busy, tiktokAvailable }: Props) {
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [includeTikTok, setIncludeTikTok] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function useFile(file?: File | null) {
    if (!file) return;
    setLocalError(null);
    try {
      setImage(await fileToDataUrl(file));
      setImageName(file.name);
    } catch (err) {
      setLocalError((err as Error).message);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (input.trim().length < 2 && !image) {
      setLocalError("Enter a product name or link, or upload a product photo.");
      return;
    }
    setLocalError(null);
    onSearch({ input: input.trim(), imageDataUrl: image || undefined, includeTikTok: includeTikTok && tiktokAvailable });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    useFile(e.dataTransfer.files?.[0]);
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`bg-white border rounded-xl p-4 sm:p-5 flex flex-col gap-3 transition ${dragging ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200"}`}
    >
      <div className="flex flex-col md:flex-row gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Product name or product link (Shopify, Amazon, brand site)…"
          aria-label="Product name or URL"
          className="flex-1 min-w-0 rounded-lg border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 md:flex-none rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            {image ? "Change photo" : "+ Product photo"}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-1 md:flex-none rounded-lg bg-brand-600 text-white font-medium px-6 py-3 text-sm hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {busy ? "Searching…" : "Find videos"}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => useFile(e.target.files?.[0])} />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {image && (
          <span className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg pl-1 pr-2 py-1">
            <img src={image} alt="" className="w-8 h-8 rounded object-cover" />
            <span className="text-slate-600 max-w-[12rem] truncate">{imageName}</span>
            <button type="button" onClick={() => setImage(null)} className="text-slate-400 hover:text-red-600" aria-label="Remove photo">
              ✕
            </button>
          </span>
        )}
        <label className={`flex items-center gap-2 ${tiktokAvailable ? "text-slate-600" : "text-slate-300"}`} title={tiktokAvailable ? "" : "TikTok is disabled on the server (ENABLE_TIKTOK)"}>
          <input type="checkbox" checked={includeTikTok} disabled={!tiktokAvailable} onChange={(e) => setIncludeTikTok(e.target.checked)} />
          Also search TikTok <span className="text-xs text-slate-400">(optional)</span>
        </label>
        <span className="text-slate-400 hidden sm:inline">Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setInput(ex)} className="text-brand-700 hover:underline">
            {ex}
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Tip: a product link or photo gives the image brain a reference picture, which makes exact-product matching much more accurate. You can also drop a photo onto this box.
      </p>
      {localError && <p className="text-sm text-red-600">{localError}</p>}
    </form>
  );
}
