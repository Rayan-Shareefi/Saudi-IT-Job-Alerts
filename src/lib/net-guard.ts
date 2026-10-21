import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Only the public internet. The laptop fetches URLs found on scraped pages
 * and URLs pasted on the repair pages, from inside a home network: a crafted
 * address such as http://192.168.1.1/ would make it open the router's pages
 * (security review, 2026-10-22). Every fetch of a URL that did not come from
 * this codebase is checked here first, and again at each redirect.
 */

/** Loopback, private, link-local, carrier-grade NAT and other non-public ranges. */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
  }
  return false;
}

/** Names that only mean something inside a network. */
export function localName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || !h.includes(".") || /\.(localhost|local|internal|lan|home|intranet|corp|home\.arpa)$/.test(h);
}

/** A literal address or local name that is not on the public internet - no DNS needed. */
export function obviouslyPrivate(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return localName(h) || (isIP(h) !== 0 && privateAddress(h));
}

/** May this URL be fetched? http(s), and every address its host resolves to is public. */
export async function isPublicUrl(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (obviouslyPrivate(host)) return false;
  if (isIP(host)) return true;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateAddress(a.address));
  } catch {
    // Does not resolve: not reachable anyway; the fetch reports it.
    return true;
  }
}

export class PrivateAddressRefused extends Error {
  constructor(url: string) {
    super(`refused: ${new URL(url).hostname} is not a public internet address`);
    this.name = "PrivateAddressRefused";
  }
}
