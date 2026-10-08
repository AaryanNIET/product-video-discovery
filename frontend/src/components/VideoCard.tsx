import { useState } from "react";
import { MatchVerdict, PLATFORM_LABEL, VideoCandidate } from "../types";
import { thumbUrl, videoProxyUrl } from "../services/api";

const VERDICT: Record<MatchVerdict, { label: string; cls: string }> = {
  exact: { label: "Exact product", cls: "bg-emerald-600 text-white" },
  very_close: { label: "Very close match", cls: "bg-emerald-100 text-emerald-800" },
  same_category: { label: "Same category only", cls: "bg-amber-100 text-amber-800" },
  different: { label: "Different product", cls: "bg-slate-200 text-slate-700" },
  unclear: { label: "Can't verify", cls: "bg-slate-200 text-slate-700" },
};

const PLATFORM_BADGE = {
  instagram: "bg-pink-600",
  meta_ads: "bg-blue-600",
  tiktok: "bg-slate-900",
};

interface Props {
  video: VideoCandidate;
  kind: "accepted" | "below" | "seen";
  shortlisted: boolean;
  onToggleShortlist: (v: VideoCandidate) => void;
  onOpenSearch?: (jobId: string) => void;
}

export default function VideoCard({ video, kind, shortlisted, onToggleShortlist, onOpenSearch }: Props) {
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const m = video.match;
  const verdict = m ? VERDICT[m.verdict] : null;
  // Instagram and Meta video files can be streamed through the backend; TikTok requires opening the original.
  const canPlay = Boolean(video.videoUrl) && video.platform !== "tiktok" && !playError;

  return (
    <article className={`bg-white border rounded-xl overflow-hidden flex flex-col ${kind === "accepted" ? "border-slate-200" : "border-dashed border-slate-300 opacity-90"}`}>
      <div className="relative aspect-[4/5] bg-slate-100">
        {playing && canPlay ? (
          <video src={videoProxyUrl(video.videoUrl!)} controls autoPlay playsInline className="w-full h-full object-contain bg-black" onError={() => setPlayError(true)} />
        ) : video.thumbId && !imgError ? (
          <img src={thumbUrl(video.thumbId)} alt={video.caption?.slice(0, 80) || "Video thumbnail"} loading="lazy" onError={() => setImgError(true)} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">No thumbnail</div>
        )}

        <span className={`absolute top-2 left-2 text-[10px] font-semibold uppercase tracking-wide text-white rounded px-1.5 py-0.5 ${PLATFORM_BADGE[video.platform]}`}>
          {PLATFORM_LABEL[video.platform].replace(" Reels", "").replace(" Library", "")}
        </span>
        {m && (
          <span className={`absolute top-2 right-2 text-sm font-bold rounded-full w-10 h-10 flex items-center justify-center shadow ${m.score >= 90 ? "bg-emerald-600 text-white" : m.score >= 70 ? "bg-emerald-100 text-emerald-800" : m.score >= 40 ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`} title="Match score (0-100)">
            {m.score}
          </span>
        )}
        {canPlay && !playing && (
          <button onClick={() => setPlaying(true)} className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/55 text-white text-lg flex items-center justify-center hover:bg-black/70" aria-label="Play video">
            ▶
          </button>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex flex-wrap gap-1">
          {verdict && m?.method === "vision" && <span className={`text-[11px] font-medium rounded px-1.5 py-0.5 ${verdict.cls}`}>{verdict.label}</span>}
          {kind === "below" && <span className="text-[11px] rounded px-1.5 py-0.5 bg-red-50 text-red-700">Below threshold</span>}
          {m?.method === "text-fallback" && <span className="text-[11px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">Caption-only score</span>}
          {video.previouslySeen && (
            <button onClick={() => onOpenSearch?.(video.previouslySeen!.jobId)} className="text-[11px] rounded px-1.5 py-0.5 bg-violet-50 text-violet-700 hover:underline">
              Seen {new Date(video.previouslySeen.at).toLocaleDateString()}
            </button>
          )}
        </div>

        {m && <p className="text-xs text-slate-700 font-medium">{m.reason}</p>}
        {m && (m.matched.length > 0 || m.mismatched.length > 0) && (
          <p className="text-[11px] text-slate-500">
            {m.matched.length > 0 && <span className="text-emerald-700">✓ {m.matched.join(", ")}</span>}
            {m.matched.length > 0 && m.mismatched.length > 0 && " · "}
            {m.mismatched.length > 0 && <span className="text-red-700">✗ {m.mismatched.join(", ")}</span>}
          </p>
        )}

        <p className="text-xs text-slate-500 truncate">
          {video.creator || "Unknown creator"}
          {video.postedAt && ` · ${new Date(video.postedAt).toLocaleDateString()}`}
        </p>
        {video.caption && (
          <p onClick={() => setExpanded((v) => !v)} className={`text-sm text-slate-600 cursor-pointer break-words ${expanded ? "" : "line-clamp-2"}`} title="Click to expand">
            {video.caption}
          </p>
        )}

        <div className="mt-auto pt-2 flex gap-2">
          <a href={video.url} target="_blank" rel="noreferrer" className="flex-1 text-xs text-center text-brand-700 border border-brand-100 rounded-lg py-1.5 hover:bg-brand-50">
            Open original
          </a>
          <button
            onClick={() => onToggleShortlist(video)}
            className={`text-xs rounded-lg px-2.5 border ${shortlisted ? "bg-amber-50 border-amber-300 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
            aria-label={shortlisted ? "Remove from shortlist" : "Add to shortlist"}
            title={shortlisted ? "Remove from shortlist" : "Add to shortlist"}
          >
            {shortlisted ? "★" : "☆"}
          </button>
        </div>
      </div>
    </article>
  );
}
