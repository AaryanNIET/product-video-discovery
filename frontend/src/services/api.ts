import axios from "axios";
import { JobStatusResponse, HistoryItem } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

const client = axios.create({ baseURL: API_BASE, timeout: 15000 });

export async function startDiscovery(input: string): Promise<{ jobId: string }> {
  const res = await client.post("/discovery", { input });
  return res.data;
}

export async function getDiscoveryStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await client.get(`/discovery/${jobId}`);
  return res.data;
}

export async function getHistory(): Promise<{ history: HistoryItem[] }> {
  const res = await client.get("/history");
  return res.data;
}
