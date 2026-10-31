import { z } from "zod";
import { askJSON, type UserContent } from "./llm.js";
import { EvidenceStore, hostname, inspectLink, mapsLookup, scrapeUrl, webSearch, type Evidence } from "./evidence.js";
import { saveReport, type BlockedClaim } from "./receipts.js";
import { SAY } from "./format.js";

// ---------------------------------------------------------------------------
// Step 4 — the hard guarantee. Pure code, no model involved.
// ---------------------------------------------------------------------------

export function normalizeForQuote(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links → their text
    .replace(/[*_`#>|]/g, " ") // markdown emphasis / headings / tables
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True only if `quote` appears verbatim (modulo whitespace/case/typography) inside `source`. */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeForQuote(quote).replace(/^["']|["']$/g, "").trim();
  // Too short to be meaningful evidence (e.g. "will not") — a receipt must carry real content.
  if (q.length < 12 || q.split(" ").length < 3) return false;
  return normalizeForQuote(source).includes(q);
}

const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** A phone number may only be called if it literally appears in fetched evidence. */
export function phoneInEvidence(phone: string, evidence: Evidence[]): Evidence | undefined {
  const d = digits(phone);
  if (d.length !== 10) return;
  return evidence.find(
    (e) => (e.kind === "maps" || e.kind === "web") && (digits(e.phone ?? "") === d || digits(e.text).includes(d)),
  );
}

export function toE164(phone: string): string | undefined {
  const d = digits(phone);
  return d.length === 10 ? `+1${d}` : undefined;
}


/** Links/domains that literally appear in text (found by regex, never by the model). */
export function extractLinks(text: string): { raw: string; url: string; domain: string }[] {
  const re = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s"'<>)]*)?)/gi;
  const seen = new Set<string>();
  const out: { raw: string; url: string; domain: string }[] = [];
  for (const m of text.matchAll(re)) {
    const raw = m[1].replace(/[.,;:!?]+$/, "");
    if (/^\d+(\.\d+)+$/.test(raw) || /@/.test(text.slice(Math.max(0, m.index! - 1), m.index!))) continue; // numbers, emails
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!/\.[a-z]{2,24}$/.test(host) || /\.(png|jpe?g|gif|pdf|txt)$/.test(host)) continue;
    const domain = host.replace(/^www\./, "");
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ raw, url, domain });
  }
  return out.slice(0, 4);
}


/** US phone numbers that literally appear in text, normalized to (xxx) xxx-xxxx. */
export function extractPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g)) {
    if (/^[01]/.test(m[1])) continue; // not a valid US area code
    out.add(`(${m[1]}) ${m[2]}-${m[3]}`);
  }
  return [...out].slice(0, 2);
}

// ---------------------------------------------------------------------------
// Step 1 — understand the request
// ---------------------------------------------------------------------------

const PlanZ = z.object({
  intent: z.enum(["verify", "call_me_demo", "smalltalk"]),
  reply: z.string(),
  screenshotText: z.string(),
  items: z.array(
    z.object({
      claim: z.string(),
      type: z.enum(["scam", "fact", "live_business", "investigate"]),
      searchQueries: z.array(z.string()),
      urls: z.array(z.string()),
      businessName: z.string(),
      businessArea: z.string(),
      phoneQuestion: z.string(),
    }),
  ),
});
export type Plan = z.infer<typeof PlanZ>;

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "reply", "screenshotText", "items"],
  properties: {
    intent: { type: "string", enum: ["verify", "call_me_demo", "smalltalk"] },
    reply: { type: "string" },
    screenshotText: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "type", "searchQueries", "urls", "businessName", "businessArea", "phoneQuestion"],
        properties: {
          claim: { type: "string" },
          type: { type: "string", enum: ["scam", "fact", "live_business", "investigate"] },
          searchQueries: { type: "array", items: { type: "string" } },
          urls: { type: "array", items: { type: "string" } },
          businessName: { type: "string" },
          businessArea: { type: "string" },
          phoneQuestion: { type: "string" },
        },
      },
    },
  },
};

const PLAN_SYSTEM = `You are the intake step of "Ask the Bro", an iMessage agent (persona: Bro, the user's chill friend) that only states facts it can prove with sources.
Read the user's message (and screenshot, if any) and decide what must be checked. You do NOT answer the question yourself.

Return JSON:
- intent:
  - "verify": the user wants something checked or looked into (a suspicious text/link/number, an invite or message from someone unknown, a claim, a rumor, a deal, whether a business is open, prices, policies, etc.)
  - "call_me_demo": the user asks Receipts to call THEM (e.g. "call me and pretend to be the bakery") to try the phone verification. Put the business they will role-play in businessName and the question to ask in phoneQuestion, type "live_business".
  - "smalltalk": greetings, thanks, "what can you do", or anything with nothing checkable.
- reply: only for smalltalk. Reply as "Bro": a chill, warm, funny friend texting back. 1-2 short lowercase-ish lines, at most one "bro/dude/bratha", max one emoji, no swearing. Nudge them to send something to fact-check (sketchy text, screenshot, rumor, "is X open?"). NEVER state facts about the world. Empty string otherwise.
- screenshotText: if an image is attached, transcribe ALL visible text verbatim (sender, links, phone numbers). Empty string if no image.
- items: 1-3 checkable claims/questions (empty for smalltalk). For each:
  - claim: a neutral one-line statement of what needs checking, e.g. "This text claiming to be from USPS asking for a $1.99 redelivery fee is legitimate".
  - type: "scam" (suspicious message/link/number/offer), "fact" (general claim), "live_business" (something only the business can answer right now: open now, availability, wait time, today's specials), "investigate" (anything personal or unclear the user wants looked into: an invite with no name, a message from an unknown number, a listing, an event, a job offer, a contest win, a "is this real?" about something that isn't a well-known claim).
  - For "investigate", split it into the concrete checkable parts as separate items (max 3), e.g. for an anonymous party invite: "The venue/address in this invite exists and is a real place", "This event is publicly listed (Partiful, Eventbrite, Luma, Instagram, the venue's site)", "The link/number in this invite is linked to known scams".
  - searchQueries: 1-2 web searches that would surface PRIMARY/official sources (official sites, government, the company's own help pages, reputable news). For scams include the official organization's guidance and the domain/number itself. For events include the event name + venue + date. For an unknown phone number, search the number itself (in quotes) with "scam" — never try to identify a private individual.
  - urls: URLs or bare domains that appear literally in the user's message or screenshot (so we can inspect them). Never invent URLs.
  - businessName / businessArea: whenever the item is about a specific LOCAL business or place (restaurant, cafe, shop, bar, club, event venue, clinic) of any type, its name or street address and city/neighborhood (default "San Francisco, CA"). Leave "" for big companies, agencies, or brands (USPS, banks, Apple) and for general claims.
  - phoneQuestion: for live_business, the single short question a caller should ask the business; else "".`;

export async function understand(text: string, images: UserContent): Promise<Plan> {
  const content: UserContent = [...images, { type: "text", text: text || "(no text — see image)" }];
  return askJSON({ system: PLAN_SYSTEM, content, jsonSchema: planSchema, zod: PlanZ, effort: "low", maxTokens: 6000 });
}

// ---------------------------------------------------------------------------
// Step 2 — gather evidence
// ---------------------------------------------------------------------------

export async function gather(plan: Plan, store: EvidenceStore, userText: string, onStatus: (s: string) => void) {
  const inputBlob = `${userText}\n${plan.screenshotText}`;
  if (userText.trim()) store.add({ kind: "input", title: "Your message", text: userText });
  if (plan.screenshotText.trim()) store.add({ kind: "input", title: "Your screenshot", text: plan.screenshotText });

  // Deterministic facts about links in what the user sent: computed by code, safe to quote.
  const links = extractLinks(inputBlob);
  if (links.length) {
    store.add({
      kind: "computed",
      title: "Link check (computed by Receipts' code, not AI)",
      text: links.map((l) => `The link "${l.raw}" in your message points to the website domain ${l.domain}.`).join("\n"),
    });
  }

  const phones = extractPhones(inputBlob);
  if (phones.length) {
    store.add({
      kind: "computed",
      title: "Number check (computed by code, not AI)",
      text: phones.map((p) => `The message contains the phone number ${p}.`).join("\n"),
    });
  }

  const jobs: Promise<unknown>[] = [];
  for (const l of links.slice(0, 2)) jobs.push(scrapeUrl(store, l.url), inspectLink(store, l.url));
  // Public scam reports for any number in the message (not identity lookups).
  for (const p of phones.slice(0, 1)) jobs.push(webSearch(store, `"${p}" scam OR spam text`, 3));
  for (const item of plan.items.slice(0, 3)) {
    for (const q of item.searchQueries.slice(0, 2)) jobs.push(webSearch(store, q, 4));
    if (item.businessName) {
      onStatus(SAY.maps(item.businessName));
      jobs.push(mapsLookup(store, item.businessName, item.businessArea || "San Francisco, CA"));
    }
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") console.warn("[gather]", (r.reason as Error).message);
}

// ---------------------------------------------------------------------------
// Step 3 — answer ONLY from evidence, with verbatim quotes
// ---------------------------------------------------------------------------

const AnswerZ = z.object({
  verdict: z.enum(["scam", "likely_scam", "legit", "true", "false", "mixed", "unverified"]),
  claims: z.array(z.object({ text: z.string(), evidenceId: z.string(), quote: z.string() })),
  unverified: z.array(z.string()),
  callSuggestion: z.object({ worthCalling: z.boolean(), evidenceId: z.string(), phone: z.string(), businessName: z.string(), question: z.string() }),
});
export type Answer = z.infer<typeof AnswerZ>;

const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "claims", "unverified", "callSuggestion"],
  properties: {
    verdict: { type: "string", enum: ["scam", "likely_scam", "legit", "true", "false", "mixed", "unverified"] },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidenceId", "quote"],
        properties: { text: { type: "string" }, evidenceId: { type: "string" }, quote: { type: "string" } },
      },
    },
    unverified: { type: "array", items: { type: "string" } },
    callSuggestion: {
      type: "object",
      additionalProperties: false,
      required: ["worthCalling", "evidenceId", "phone", "businessName", "question"],
      properties: {
        worthCalling: { type: "boolean" },
        evidenceId: { type: "string" },
        phone: { type: "string" },
        businessName: { type: "string" },
        question: { type: "string" },
      },
    },
  },
};

const ANSWER_SYSTEM = `You are the answering step of "Ask the Bro". You may ONLY use the numbered EVIDENCE provided. Your own knowledge is not allowed — not even for well-known facts.

Rules:
1. Every claim you make must cite one evidenceId and include "quote": a span copied CHARACTER-FOR-CHARACTER from that evidence's text (5-30 words). Do not paraphrase, fix typos, merge sentences, or add ellipses inside a quote. Quotes that are not exact will be automatically deleted.
2. Claim "text" must say no more than its quote supports. One fact per claim. Max 4 claims, most decisive first.
   Write claim "text" like a friend texting: casual, lowercase-ish, max 14 words, attributed to the source, e.g. "they said on yelp their meat's not certified halal" or "usps says they never text you links like this". No "bro" inside claims, no emojis, no slang that changes the meaning, no commentary or opinions (put caveats in "unverified").
   Prefer statements made by the business/organization itself (its website, its replies, a call) over third parties.
3. Evidence titled "Your message"/"Your screenshot" is what the USER sent: you may quote it only to describe what the suspicious message says, never as proof that something is true. Evidence of kind "computed" is a deterministic fact produced by code (e.g. the real domain a link points to) and can be quoted as proof.
4. If evidence is missing, weak, outdated, or conflicting, say so in "unverified" (short casual phrases of what you could not confirm, e.g. "whether it's certified halal") — never fill gaps.
5. verdict: "scam"/"likely_scam"/"legit" for suspicious messages and investigations (invites, unknown senders, offers); "true"/"false"/"mixed" for claims; "unverified" when evidence is insufficient. Be conservative: "legit" needs positive proof (e.g. the event is publicly listed, the venue is real), not just absence of scam reports. For investigations, report what checked out and what didn't as separate claims (e.g. "the address is a real bar in the mission", "no public listing for this party found" goes in unverified). Never identify or speculate about who a private person is.
6. callSuggestion.worthCalling = true when the question is about a specific business and the business itself could settle it on the phone (open now, availability, wait times, ingredients/halal/allergens/vegan, policies, prices) AND the verdict is not already fully proven by the business's own words, AND an evidence item contains its phone number. Copy that phone number exactly and the evidenceId it came from; question = one short, neutral question for the caller (e.g. "Is your meat halal-certified?"). Otherwise worthCalling=false and other fields "".
7. For a phone-call transcript, only lines starting "Business:" are statements by the business.`;

function renderEvidence(items: Evidence[]) {
  return items
    .map((e) => `[${e.id}] (${e.kind}) ${e.title}${e.url ? ` — ${e.url}` : ""}\n${e.text}`)
    .join("\n\n---\n\n");
}

export async function answer(question: string, store: EvidenceStore): Promise<Answer> {
  const content: UserContent = [
    { type: "text", text: `QUESTION TO CHECK:\n${question}\n\nEVIDENCE:\n\n${renderEvidence(store.all())}` },
  ];
  return askJSON({ system: ANSWER_SYSTEM, content, jsonSchema: answerSchema, zod: AnswerZ, effort: "low", maxTokens: 8000 });
}

// ---------------------------------------------------------------------------
// Step 5 — independent support check (does the quote actually back the claim?)
// ---------------------------------------------------------------------------

const SupportZ = z.object({ results: z.array(z.object({ index: z.number(), supported: z.boolean() })) });

async function supportCheck(claims: (Answer["claims"][number] & { ev: Evidence })[]): Promise<boolean[]> {
  if (claims.length === 0) return [];
  const listing = claims
    .map((c, i) => `#${i}\nSOURCE: ${c.ev.title}${c.ev.url ? ` (${c.ev.url})` : ""} [${c.ev.kind}]\nCLAIM: ${c.text}\nQUOTE: "${c.quote}"`)
    .join("\n\n");
  const res = await askJSON({
    system:
      "You are a strict fact-checking auditor. For each item, decide whether the QUOTE, taken from the named SOURCE, supports the CLAIM. Attribution is fine: a claim like \"Yelp's business answer says X\" is supported if the source is that Yelp page and the quote says X. Casual texting wording is fine as long as the meaning exactly matches the quote. A claim is NOT supported if it adds facts, numbers, times, causes, or certainty that the quote doesn't contain, or if it misstates what the quote says.",
    content: [{ type: "text", text: listing }],
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["index", "supported"],
            properties: { index: { type: "integer" }, supported: { type: "boolean" } },
          },
        },
      },
    },
    zod: SupportZ,
    effort: "low",
    maxTokens: 3000,
  });
  return claims.map((_, i) => res.results.find((r) => r.index === i)?.supported === true);
}

// ---------------------------------------------------------------------------
// Steps 3-5 combined: produce only claims that survive both checks
// ---------------------------------------------------------------------------

export type VerifiedClaim = { text: string; quote: string; evidence: Evidence };
export type Verified = {
  verdict: Answer["verdict"];
  claims: VerifiedClaim[];
  dropped: number;
  unverified: string[];
  call?: { phone: string; businessName: string; question: string; source: Evidence };
  checked: Evidence[];
  reportId: string;
};

export async function verifyWithEvidence(question: string, store: EvidenceStore): Promise<Verified> {
  const raw = await answer(question, store);
  const blocked: BlockedClaim[] = [];

  // Step 4: exact-quote check against the stored source text.
  const quoted = raw.claims.flatMap((c) => {
    const ev = store.get(c.evidenceId.trim());
    // On a call transcript, only what the business said counts — never our own caller's words.
    const quotable = ev?.kind === "call" ? ev.text.split("\n").filter((l) => l.startsWith("Business:")).join("\n") : ev?.text;
    if (!ev || !quotable || !quoteInSource(c.quote, quotable)) {
      console.log(`[verify] BLOCKED (quote not in ${c.evidenceId}): ${c.text} | "${c.quote}"`);
      blocked.push({ ...c, reason: ev ? "quote_not_in_source" : "unknown_source" });
      return [];
    }
    return [{ ...c, ev }];
  });

  // Step 5: support check.
  const supported = await supportCheck(quoted);
  const claims: VerifiedClaim[] = [];
  quoted.forEach((c, i) => {
    if (supported[i]) claims.push({ text: c.text, quote: c.quote, evidence: c.ev });
    else {
      console.log(`[verify] BLOCKED (unsupported): ${c.text}`);
      blocked.push({ text: c.text, quote: c.quote, evidenceId: c.evidenceId, reason: "quote_does_not_support" });
    }
  });

  // Proof claims must come from real sources, not from what the user sent us.
  const proofClaims = claims.filter((c) => c.evidence.kind !== "input");
  let verdict = raw.verdict;
  if (proofClaims.length === 0 && verdict !== "unverified") verdict = "unverified";

  let call: Verified["call"];
  if (raw.callSuggestion.worthCalling) {
    const src = phoneInEvidence(raw.callSuggestion.phone, store.all());
    const e164 = toE164(raw.callSuggestion.phone);
    // Never call a number that came from the suspicious message itself (unknown senders, scam lines).
    const fromInput = store.all().some((e) => (e.kind === "input" || e.kind === "computed") && digits(e.text).includes(digits(raw.callSuggestion.phone)));
    if (src && e164 && !fromInput) call = { phone: e164, businessName: raw.callSuggestion.businessName, question: raw.callSuggestion.question, source: src };
  }

  const report = saveReport({ question, verdict, kept: claims, blocked, unverified: raw.unverified, evidence: store.all() });

  return {
    verdict,
    claims,
    dropped: blocked.length,
    unverified: raw.unverified,
    call,
    checked: store.all().filter((e) => e.kind !== "input"),
    reportId: report.id,
  };
}

export function sourceLabel(e: Evidence) {
  if (e.kind === "call") return e.title;
  if (e.kind === "maps") return "Google Maps listing";
  if (e.kind === "computed") return "link check (computed by code)";
  return hostname(e.url) || e.title;
}
