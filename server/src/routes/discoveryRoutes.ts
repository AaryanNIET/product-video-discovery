import { Router } from "express";
import rateLimit from "express-rate-limit";
import { postDiscovery, getDiscovery, getHistory } from "../controllers/discoveryController";

const router = Router();

// Rate-limit the expensive discovery-start endpoint (per the assignment's security requirement).
const discoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many discovery requests, please wait a moment." },
});

router.post("/discovery", discoveryLimiter, postDiscovery);
router.get("/discovery/:jobId", getDiscovery);
router.get("/history", getHistory);

export default router;
