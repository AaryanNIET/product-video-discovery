import { useCallback, useEffect, useRef, useState } from "react";
import SearchBar from "../components/SearchBar";
import ProgressSteps from "../components/ProgressSteps";
import ProductCard from "../components/ProductCard";
import ResultsSection from "../components/ResultsSection";
import HistoryPanel from "../components/HistoryPanel";
import { startDiscovery, getDiscoveryStatus, getHistory } from "../services/api";
import { JobStatusResponse, HistoryItem } from "../types";

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;

export default function Dashboard() {
  const [job, setJob] = useState<JobStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const refreshHistory = useCallback(() => {
    getHistory()
      .then((r) => setHistory(r.history))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const runSearch = useCallback(
    async (input: string) => {
      setError(null);
      setLoading(true);
      setJob(null);
      if (pollRef.current) clearInterval(pollRef.current);

      try {
        const { jobId } = await startDiscovery(input);
        startTimeRef.current = Date.now();

        pollRef.current = setInterval(async () => {
          try {
            const status = await getDiscoveryStatus(jobId);
            setJob(status);

            const finished = ["completed", "partial_success", "failed"].includes(status.status);
            const timedOut = Date.now() - startTimeRef.current > POLL_TIMEOUT_MS;

            if (finished || timedOut) {
              if (pollRef.current) clearInterval(pollRef.current);
              setLoading(false);
              if (status.status === "failed") setError("Discovery failed. Check pipeline progress for details.");
              refreshHistory();
            }
          } catch {
            if (pollRef.current) clearInterval(pollRef.current);
            setLoading(false);
            setError("Lost connection while polling for results.");
          }
        }, POLL_INTERVAL_MS);
      } catch (err: any) {
        setLoading(false);
        setError(err?.response?.data?.message || err?.response?.data?.error || "Could not start discovery. Is the backend running?");
      }
    },
    [refreshHistory]
  );

  const results = job?.results;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold text-slate-900">Product Video Discovery Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Find Instagram Reels and Meta Ad Library ads that show your exact product.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">
        <SearchBar onSearch={runSearch} loading={loading} />

        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

        {(loading || job) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 flex flex-col gap-6">
              {results?.product && <ProductCard product={results.product} />}
              {job && <ProgressSteps steps={job.progress} />}
              <HistoryPanel items={history} onSelect={runSearch} />
            </div>

            <div className="lg:col-span-2 flex flex-col gap-6">
              <ResultsSection
                title="Instagram Reels"
                minimum={20}
                result={results?.instagram ?? null}
                loading={loading}
                onRetry={() => results && runSearch(results.product.productName)}
              />
              <ResultsSection
                title="Meta Ad Library"
                minimum={20}
                result={results?.metaAds ?? null}
                loading={loading}
                onRetry={() => results && runSearch(results.product.productName)}
              />
            </div>
          </div>
        )}

        {!loading && !job && (
          <div className="flex flex-col gap-6">
            <div className="bg-white border border-dashed border-slate-300 rounded-xl p-10 text-center text-slate-400 text-sm">
              Enter a product name or URL above to start a discovery search.
            </div>
            <HistoryPanel items={history} onSelect={runSearch} />
          </div>
        )}
      </main>
    </div>
  );
}
