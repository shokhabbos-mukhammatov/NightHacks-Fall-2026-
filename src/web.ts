import type { Express } from "express";
import type { Evidence } from "./evidence.js";
import { page, pretty } from "./join.js";
import { cfg } from "./config.js";
import { getReport, stats, type BlockedClaim } from "./receipts.js";
import { normalizeForQuote, sourceLabel } from "./verify.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const VERDICT: Record<string, string> = {
  scam: "🚩 Scam",
  likely_scam: "🚩 Likely a scam",
  legit: "✅ Looks legit",
  true: "✅ True",
  false: "❌ False",
  mixed: "⚖️ Partly true",
  unverified: "🤷 Couldn't prove it either way",
};

const REASON: Record<BlockedClaim["reason"], string> = {
  quote_not_in_source: "the quoted words don't appear in the source (checked by code)",
  quote_does_not_support: "the quote is real but doesn't prove the claim (independent audit)",
  unknown_source: "it cited a source that doesn't exist",
};

/** Show the quote highlighted inside ~220 chars of its real surrounding source text. */
function inContext(quote: string, source: string): string {
  // Map each char of the whitespace-collapsed lowercase source back to the original index.
  const map: number[] = [];
  let flat = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      if (flat.endsWith(" ") || flat === "") continue;
      flat += " ";
    } else flat += ch.toLowerCase();
    map.push(i);
  }
  const q = quote.replace(/\s+/g, " ").trim().toLowerCase().replace(/^["'“”]|["'“”]$/g, "");
  const at = flat.indexOf(q);
  if (at === -1) return `<mark>${esc(quote)}</mark>`; // matched only after markdown/typography normalization
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  const pre = source.slice(Math.max(0, start - 220), start);
  const post = source.slice(end, end + 220);
  return `${start > 220 ? "…" : ""}${esc(pre)}<mark>${esc(source.slice(start, end))}</mark>${esc(post)}${end + 220 < source.length ? "…" : ""}`;
}

function sourceLine(e: Evidence) {
  const label = esc(e.kind === "call" ? e.title : sourceLabel(e));
  return e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${label}</a>` : label;
}

const css = `<style>
  .claim { border-left: 4px solid #30d158; padding: 8px 12px; margin: 12px 0; background: rgba(48,209,88,.07); border-radius: 8px; }
  .blocked { border-left: 4px solid #ff453a; padding: 8px 12px; margin: 10px 0; background: rgba(255,69,58,.07); border-radius: 8px; }
  .blocked s { opacity: .75; } .ctx { font-size: 14px; opacity: .85; margin-top: 6px; white-space: pre-wrap; }
  mark { background: #ffd60a; color: #000; padding: 0 2px; border-radius: 3px; } h2 { font-size: 19px; margin: 22px 0 6px; }
  .src { font-size: 14px; margin-top: 4px; } .big { font-size: 56px; font-weight: 800; line-height: 1; } .row { display: flex; gap: 22px; justify-content: space-between; }
  .card { max-width: 640px !important; } a { color: #0a84ff; }
</style>`;

export function mountWeb(app: Express) {
  app.get("/r/:id", (req, res) => {
    const r = getReport(req.params.id);
    if (!r) return res.status(404).type("html").send(page(`<h1>Receipt expired</h1><p>This server restarted since the check ran.</p>`));
    const byId = new Map(r.evidence.map((e) => [e.id, e]));

    const kept = r.kept
      .map(
        (c) => `<div class="claim"><b>${esc(c.text)}</b>
<div class="ctx">${inContext(c.quote, c.evidence.text)}</div>
<div class="src">Source: ${sourceLine(c.evidence)}</div></div>`,
      )
      .join("");

    const blocked = r.blocked
      .map((b) => {
        const ev = byId.get(b.evidenceId);
        return `<div class="blocked"><s>${esc(b.text)}</s><div class="src">Blocked: ${REASON[b.reason]}${ev ? ` · cited ${sourceLine(ev)}` : ""}</div>
<div class="ctx">Claimed quote: “${esc(b.quote)}”</div></div>`;
      })
      .join("");

    const checked = r.evidence
      .filter((e) => e.kind !== "input")
      .map((e) => `<li>${sourceLine(e)} <small>${e.kind}</small></li>`)
      .join("");

    res.type("html").send(
      page(`${css}<h1>${VERDICT[r.verdict] ?? r.verdict}</h1>
<p class="sub">${esc(r.question)}</p>
<h2>✅ What Bro could prove (${r.kept.length})</h2>${kept || "<p>Nothing could be proven with an exact quote, so Bro didn't claim anything.</p>"}
${r.unverified.length ? `<h2>🤷 Couldn't confirm</h2><ul>${r.unverified.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
<h2>🛡️ What Bro tossed, because he couldn't back it up (${r.blocked.length})</h2>${blocked || "<p>Nothing needed tossing on this one.</p>"}
<h2>🔎 Where Bro looked</h2><ul>${checked || "<li>No sources returned anything.</li>"}</ul>
<p><small>Quotes are matched word-for-word against the stored source by code (ignoring only case, spacing, and quote styles). Checked ${new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT.</small></p>`),
    );
  });

  // Big-screen view for the demo table / stage.
  app.get("/live", (_req, res) => {
    const recent = stats.recent
      .map((x) => `<li>${VERDICT[x.verdict] ?? x.verdict}: ${esc(x.question)} <small>(${x.kept} proven, ${x.blocked} blocked)</small></li>`)
      .join("");
    res.type("html").send(
      page(`${css}<meta http-equiv="refresh" content="4"><h1>Ask the Bro 🤙 live</h1><p class="sub">Text Bro on iMessage: <b>${pretty(cfg.broNumber)}</b> (join at ${cfg.baseUrl.replace(/^https?:\/\//, "")} first)</p>
<div class="row"><div><div class="big">${stats.checks}</div>checks</div><div><div class="big">${stats.claimsKept}</div>claims proven</div><div><div class="big" style="color:#ff453a">${stats.claimsBlocked}</div>unproven claims tossed</div></div>
<h2>Latest</h2><ul>${recent || "<li>Waiting for the first text…</li>"}</ul>`),
    );
  });

  app.get("/stats", (_req, res) => res.json({ ...stats, recent: undefined }));
}

// Exposed for tests.
export const _inContext = inContext;
export const _normalize = normalizeForQuote;
