import dns from "dns/promises";
import net from "net";

export class UnsafeUrlError extends Error {
  status = 400;
}

export class FetchFailedError extends Error {
  constructor(message: string, public httpStatus?: number) {
    super(message);
  }
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public ranges (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return true; // unknown format: refuse
}

/**
 * Validates a user-supplied URL before the server fetches it (SSRF guard):
 * http/https only, no credentials, standard ports, and every DNS answer must
 * be a public address. Re-run on every redirect hop.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a valid URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new UnsafeUrlError("Only http and https links are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded credentials are not allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Only standard web ports are allowed.");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$/i.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Internal addresses are not allowed.");
  }

  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new UnsafeUrlError(`Could not resolve ${host}.`);
    }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError("Internal or private network addresses are not allowed.");
  }
  return url;
}

export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Skip the public-address check (only for hosts we already trust, e.g. known CDNs). */
  trusted?: boolean;
}

/**
 * fetch() with SSRF protection, manual redirect validation, a timeout and a
 * response-size cap. Returns the final URL alongside the body.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<{ url: string; status: number; contentType: string; body: Buffer }> {
  const { maxBytes = 5 * 1024 * 1024, timeoutMs = 12000, headers = BROWSER_HEADERS, trusted = false } = opts;
  let current = rawUrl;

  for (let hop = 0; hop <= 5; hop++) {
    const url = trusted ? new URL(current) : await assertPublicUrl(current);
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, url).toString();
      continue;
    }

    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > maxBytes) throw new FetchFailedError(`Response too large (${declared} bytes)`);

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new FetchFailedError("Response too large");
        }
        chunks.push(value);
      }
    }
    return {
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get("content-type") || "",
      body: Buffer.concat(chunks),
    };
  }
  throw new FetchFailedError("Too many redirects");
}
