import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getHistory, getSearch, postSearch, streamSearch } from "../controllers/searchController";
import { addToShortlist, exportShortlist, listShortlist, removeFromShortlist } from "../controllers/shortlistController";
import { getReference, getThumb, proxyVideo } from "../controllers/mediaController";

const router = Router();

// Each search costs scraper credit and vision calls: cap how fast one client can start them.
const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many searches in a minute. Please wait a moment and try again." },
});

router.post("/search", searchLimiter, postSearch);
router.get("/search/:id", getSearch);
router.get("/search/:id/events", streamSearch);
router.get("/history", getHistory);

router.get("/shortlist", listShortlist);
router.post("/shortlist", addToShortlist);
router.delete("/shortlist/:key", removeFromShortlist);
router.get("/shortlist/export", exportShortlist);

router.get("/media/thumb/:id", getThumb);
router.get("/media/ref/:id", getReference);
router.get("/media/video", proxyVideo);

export default router;
