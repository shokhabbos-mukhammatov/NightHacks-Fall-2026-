import { cfg } from "./config.js";

export type Evidence = {
  id: string; // "E1", "E2", ... — what the model cites
  kind: "web" | "maps" | "call" | "input" | "computed";
  title: string;
  url?: string;
  phone?: string;
  /** The exact text the model is allowed to quote from. Quotes are checked against this verbatim. */
  text: string;
  fetchedAt: string;
};

export class EvidenceStore {
  private items: Evidence[] = [];
  add(e: Omit<Evidence, "id" | "fetchedAt">): Evidence {
    const item = { ...e, id: `E${this.items.length + 1}`, fetchedAt: new Date().toISOString() };
    this.items.push(item);
    return item;
  }
  get(id: string) {
    return this.items.find((e) => e.id === id);
  }
  all() {
    return [...this.items];
  }
  get size() {
    return this.items.length;
  }
}

const MAX_DOC_CHARS = 6000;

function trimDoc(text: string) {
  return text.replace(/\n{3,}/g, "\n\n").slice(0, MAX_DOC_CHARS);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${label} timed out`)), ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

/** Firecrawl v2 search with full-page markdown for each hit. */
export async function webSearch(store: EvidenceStore, query: string, limit = 4): Promise<Evidence[]> {
  if (!cfg.firecrawlKey) return [];
  const res = await withTimeout(
    fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: [{ type: "markdown" }], onlyMainContent: true },
      }),
    }),
    45_000,
    "web search",
  );
  if (!res.ok) throw new Error(`firecrawl search ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as any;
  const hits: any[] = body?.data?.web ?? (Array.isArray(body?.data) ? body.data : []);
  return hits
    .filter((h) => h?.url && (h.markdown || h.description))
    .map((h) =>
      store.add({
        kind: "web",
        title: h.title ?? h.metadata?.title ?? h.url,
        url: h.url,
        text: trimDoc(h.markdown || h.description),
      }),
    );
}

/** Firecrawl v2 scrape of one URL (official site, or the suspicious link itself). */
export async function scrapeUrl(store: EvidenceStore, url: string): Promise<Evidence | undefined> {
  if (!cfg.firecrawlKey) return;
  const res = await withTimeout(
    fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.firecrawlKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    }),
    40_000,
    "scrape",
  );
  if (!res.ok) {
    // A dead / blocked suspicious domain is itself a signal; record it as a fact we observed.
    return store.add({
      kind: "web",
      title: `Attempt to open ${url}`,
      url,
      text: `Fetching ${url} failed with HTTP status ${res.status}.`,
    });
  }
  const body = (await res.json()) as any;
  const md: string = body?.data?.markdown ?? "";
  const finalUrl: string = body?.data?.metadata?.url ?? body?.data?.metadata?.sourceURL ?? url;
  return store.add({
    kind: "web",
    title: body?.data?.metadata?.title ?? url,
    url: finalUrl,
    text: trimDoc(md || "(page had no readable text)"),
  });
}

/** Apify Google Maps actor → official listing (phone, hours, status). */
export async function mapsLookup(store: EvidenceStore, query: string, near = "San Francisco, CA"): Promise<Evidence[]> {
  if (!cfg.apifyToken) return [];
  const url = `https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items?token=${cfg.apifyToken}&timeout=90`;
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: [query],
        locationQuery: near,
        maxCrawledPlacesPerSearch: 2,
        language: "en",
        skipClosedPlaces: false,
      }),
    }),
    100_000,
    "maps lookup",
  );
  if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const places = (await res.json()) as any[];
  return places.slice(0, 2).map((p) => {
    const hours = Array.isArray(p.openingHours)
      ? p.openingHours.map((h: any) => `${h.day}: ${h.hours}`).join("\n")
      : "";
    const lines = [
      `Name: ${p.title}`,
      p.address && `Address: ${p.address}`,
      p.phone && `Phone: ${p.phone}`,
      p.website && `Website: ${p.website}`,
      p.permanentlyClosed ? "Status: Permanently closed" : p.temporarilyClosed ? "Status: Temporarily closed" : "",
      typeof p.totalScore === "number" && `Rating: ${p.totalScore} (${p.reviewsCount ?? 0} reviews)`,
      hours && `Opening hours:\n${hours}`,
    ].filter(Boolean);
    return store.add({
      kind: "maps",
      title: `Google Maps listing: ${p.title}`,
      url: p.url,
      phone: p.phone ?? p.phoneUnformatted,
      text: lines.join("\n"),
    });
  });
}

export function hostname(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
