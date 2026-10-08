import { useCallback, useEffect, useRef, useState } from "react";
import SearchBar from "../components/SearchBar";
import ProgressPanel from "../components/ProgressPanel";
import ProductPanel from "../components/ProductPanel";
import ResultsPanel from "../components/ResultsPanel";
import HistoryPanel from "../components/HistoryPanel";
import ShortlistPanel from "../components/ShortlistPanel";
import ScoreLegend from "../components/ScoreLegend";
import { addToShortlist, errorMessage, getHealth, getHistory, getSearch, getShortlist, removeFromShortlist, startSearch, watchSearch } from "../services/api";
import { Health, HistoryItem, SearchJob, ShortlistItem, VideoCandidate } from "../types";

type SearchBody = { input: string; imageDataUrl?: string; includeTikTok: boolean };

export default function Dashboard() {
  const [job, setJob] = useState<SearchJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistItem[]>([]);
  const [showShortlist, setShowShortlist] = useState(false);
  const stopWatching = useRef<() => void>();
  const lastBody = useRef<SearchBody | null>(null);

  const refreshHistory = useCallback(() => getHistory().then(setHistory).catch(() => {}), []);
  const refreshShortlist = useCallback(() => getShortlist().then(setShortlist).catch(() => {}), []);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setError("Cannot reach the backend. Start it with `npm run dev` in backend/."));
    refreshHistory();
    refreshShortlist();
    return () => stopWatching.current?.();
  }, [refreshHistory, refreshShortlist]);

  const follow = useCallback(
    (jobId: string) => {
      stopWatching.current?.();
      stopWatching.current = watchSearch(
        jobId,
        (j) => {
          setJob(j);
          const done = ["completed", "partial", "failed"].includes(j.status);
          setBusy(!done);
          if (done) {
            if (j.status === "failed") setError(j.error || "The search failed. See the pipeline panel for details.");
            refreshHistory();
          }
        },
        (msg) => {
          setBusy(false);
          setError(msg);
        }
      );
    },
    [refreshHistory]
  );

  const runSearch = useCallback(
    async (body: SearchBody) => {
      setError(null);
      setBusy(true);
      setJob(null);
      lastBody.current = body;
      try {
        const jobId = await startSearch(body);
        follow(jobId);
        refreshHistory();
      } catch (err) {
        setBusy(false);
        setError(errorMessage(err, "Could not start the search."));
      }
    },
    [follow, refreshHistory]
  );

  const openSearch = useCallback(
    async (jobId: string) => {
      setError(null);
      try {
        const j = await getSearch(jobId);
        setJob(j);
        if (!["completed", "partial", "failed"].includes(j.status)) {
          setBusy(true);
          follow(jobId);
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        setError(errorMessage(err, "Could not open that search."));
      }
    },
    [follow]
  );

  const shortlistKeys = new Set(shortlist.map((s) => s.key));
  const toggleShortlist = async (v: VideoCandidate) => {
    try {
      if (shortlistKeys.has(v.key)) await removeFromShortlist(v.key);
      else await addToShortlist(v, job?.product?.title, job?.jobId);
      refreshShortlist();
    } catch (err) {
      setError(errorMessage(err, "Could not update the shortlist."));
    }
  };

  const setupWarnings = health
    ? [
        health.providerMode === "mock" && "Mock mode: videos are generated sample data, not real Instagram/Meta results (PROVIDER_MODE=mock).",
        health.scraper.startsWith("missing") && "APIFY_TOKEN is missing in backend/.env, so Instagram, Meta and TikTok searches will fail.",
        health.vision.startsWith("missing") && "GEMINI_API_KEY is missing in backend/.env: match scores use captions only and cannot verify the exact product.",
        health.database.startsWith("unavailable") && "MongoDB is not connected: history, the seen-video index and the shortlist reset when the server restarts.",
      ].filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">Product Video Discovery</h1>
            <p className="text-xs text-slate-500 hidden sm:block">Instagram Reels and Meta Ad Library videos that show your exact product</p>
          </div>
          <button onClick={() => setShowShortlist(true)} className="shrink-0 text-sm rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">
            ★ Shortlist <span className="text-slate-400">({shortlist.length})</span>
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        {setupWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
            <ul className="list-disc pl-4 space-y-0.5">
              {setupWarnings.map((w) => (
                <li key={String(w)}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <SearchBar onSearch={runSearch} busy={busy} tiktokAvailable={health?.tiktokAvailable ?? true} />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl px-4 py-3 flex items-start justify-between gap-3" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {/* Narrow screens: product + progress, then results, then legend + history. Wide: two columns. */}
        <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-5 items-start">
          {/* "contents" lets the two sidebar groups sit around the results on narrow screens */}
          <div className="contents lg:flex lg:flex-col lg:gap-5">
            {job && (
              <aside className="order-1 flex flex-col gap-5">
                {job.product && <ProductPanel product={job.product} />}
                <ProgressPanel job={job} />
              </aside>
            )}
            <aside className="order-3 flex flex-col gap-5">
              <ScoreLegend threshold={job?.matchThreshold ?? health?.matchThreshold ?? 65} />
              <HistoryPanel items={history} activeJobId={job?.jobId} onOpen={openSearch} onRerun={(h) => runSearch({ input: h.input, includeTikTok: false })} />
            </aside>
          </div>

          <div className={`min-w-0 ${job ? "order-2" : "order-first"} lg:order-none`}>
            {job ? (
              job.status === "failed" && !Object.values(job.sources).some((s) => s?.accepted.length) && !job.product ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                  <p className="font-medium text-slate-700">This search could not run.</p>
                  <p className="text-sm text-slate-500 mt-1">{job.error}</p>
                  <p className="text-sm text-slate-500 mt-3">Try another link, paste the product name instead, or upload a product photo.</p>
                </div>
              ) : (
                <ResultsPanel job={job} shortlistKeys={shortlistKeys} onToggleShortlist={toggleShortlist} onOpenSearch={openSearch} onRetry={() => lastBody.current && runSearch(lastBody.current)} />
              )
            ) : (
              <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-slate-500">
                <p className="font-medium text-slate-700">Search by product name, product link or photo.</p>
                <p className="text-sm mt-2 max-w-xl mx-auto">
                  The image brain reads the product photo, builds search terms for each platform, collects at least {health?.minimumPerSource ?? 20} Instagram Reels and {health?.minimumPerSource ?? 20} Meta Ad Library videos, and scores every video 0-100 for how exactly it shows your product. Each new search skips videos you have already seen.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showShortlist && (
        <ShortlistPanel
          items={shortlist}
          onClose={() => setShowShortlist(false)}
          onRemove={async (key) => {
            await removeFromShortlist(key).catch(() => {});
            refreshShortlist();
          }}
        />
      )}
    </div>
  );
}
