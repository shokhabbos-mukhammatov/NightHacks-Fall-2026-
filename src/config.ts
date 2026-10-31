const get = (k: string) => process.env[k]?.trim() || undefined;

export const cfg = {
  photon: {
    projectId: get("PHOTON_PROJECT_ID") ?? "pho_prj_01m67q51d8fap8x5tscbrkv21z",
    apiKey: get("PHOTON_API_KEY"),
  },
  anthropicModel: get("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  firecrawlKey: get("FIRECRAWL_API_KEY"),
  apifyToken: get("APIFY_TOKEN"),
  cartesia: {
    apiKey: get("CARTESIA_API_KEY"),
    agentId: get("CARTESIA_AGENT_ID"),
    fromNumberId: get("CARTESIA_FROM_NUMBER_ID"),
    webhookSecret: get("CARTESIA_WEBHOOK_SECRET"),
  },
  baseUrl: (get("BASE_URL") ?? get("RAILWAY_PUBLIC_DOMAIN")?.replace(/^/, "https://") ?? "http://localhost:3000").replace(/\/$/, ""),
  port: Number(get("PORT") ?? 3000),
  maxCallsPerUser: Number(get("MAX_CALLS_PER_USER") ?? 2),
};

export function missing(...keys: (string | undefined)[]): boolean {
  return keys.some((k) => !k);
}

export function logConfig() {
  const flag = (v: unknown) => (v ? "✓" : "✗");
  console.log(
    `[config] photon ${flag(cfg.photon.apiKey)} | claude ${flag(process.env.ANTHROPIC_API_KEY)} (${cfg.anthropicModel}) | firecrawl ${flag(cfg.firecrawlKey)} | apify ${flag(cfg.apifyToken)} | cartesia ${flag(cfg.cartesia.apiKey && cfg.cartesia.agentId && cfg.cartesia.fromNumberId)} | base ${cfg.baseUrl}`,
  );
}
