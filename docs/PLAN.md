# Receipts: build plan and status

Team: Shokhabbos + Akmal · Night Hack (Founders, Inc.), Oct 30, 2026 · Track: **Photon, Best iMessage Agent You Can Text**
Hard deadline: **submissions due 9:00 PM**, top-7 demos around 10:00 PM (90 s, no slides).

## 1. Why this idea

- General "do things for me" iMessage agents already exist (Meta Muse, Poke). An earlier iMessage hackathon was won by "Booked", restaurant calls into bookings. We need something that doesn't look like them.
- LLM agents state things confidently that aren't true. We make **never making things up** the product itself.
- **Receipts:** text it anything you're not sure is true (a scam text, a screenshot, a group-chat claim, "is X open right now?"). It verifies against primary sources, and when the web isn't enough **it calls the real source and asks**.
- Every reply carries receipts: a verbatim quote and link, or a quote from the call transcript. Anything it can't prove is marked ❓.

Why it fits iMessage: scam texts and forwarded rumors arrive in iMessage, so the fact-checker lives where the problem is.

## 2. The verification guarantee

**Guarantee:** every fact Receipts states is backed by a verbatim quote from a source it actually fetched or heard.
**Not claimed:** zero errors overall. A wrong source can still produce a wrong ✅, which is why the quote and link are always shown.

Pipeline (`src/verify.ts`):

| Step | What | Who |
|---|---|---|
| 1. Understand | Turn the message or screenshot into 1–3 checkable items (`scam` / `fact` / `live_business`), with search queries and any URLs literally present in the input | Claude, structured JSON |
| 2. Gather | Store each piece of evidence with an id (`E1`, `E2`, …):<br>• Firecrawl search: about 4 results per query, full markdown<br>• Firecrawl scrape: the suspicious or official URL<br>• Apify Google Maps: the official listing with phone and hours<br>• the call transcript | code |
| 3. Answer | Claude may use **only** the evidence. Each claim needs `{text, evidenceId, quote}` | Claude, structured JSON |
| 4. **Exact-quote check** | After normalizing whitespace, case and quote marks, the quote must be a substring of the stored source, or the claim is **deleted**. Also enforced:<br>• minimum 3 words and 12 characters<br>• on call transcripts, only the business's lines count | **plain code (`quoteInSource`)** |
| 5. Support check | A second, independent Claude pass decides whether each quote fully supports its claim; unsupported claims are deleted | Claude |
| 6. Render | Reply with a verdict (🚩 / ✅ / ❌ / ⚖️ / ❓), surviving claims with quotes, and numbered receipts. If no proof survives, the verdict is forced to ❓ with the list of what was checked | code (`src/format.ts`) |

Extra rules:
- **Phone numbers are never invented.** A number is dialed only if it appears verbatim in Maps or web evidence (`phoneInEvidence`). Demo mode dials the texter's own number.
- What the user sent counts as evidence of *what the message says*, never as proof that it's true.
- Claude's server-side refusal fallback is enabled (`fallbacks: "default"`).

## 3. Architecture

```
iPhone ──iMessage──▶ Photon shared line ──Socket.IO "delivery"──▶ src/photon.ts (normalize)
                                                                     │
                                                       src/agent.ts (per-chat queue, typing, state)
                                                                     │
                     ┌───────────── src/verify.ts ──────────────────┤
                     │ understand → gather → answer → quote check → support check
                     │                 │
                     │      src/evidence.ts: Firecrawl search/scrape, Apify Maps
                     │      src/phone.ts: Cartesia outbound call → poll → transcript evidence
                     └──▶ src/format.ts ──▶ Photon POST /messages ──▶ iPhone
src/join.ts: GET / (landing page + QR), POST /join → Photon create shared-line assignment → "Open iMessage" sms: link
```

| File | Role |
|---|---|
| `src/index.ts` | Express server (join page, `/health`) and Photon listener |
| `src/photon.ts` | Socket.IO subscribe and reconnect; send, typing, download attachment; create assignment |
| `src/agent.ts` | Conversation flow: onboarding, verify, "call" follow-up, "call me" demo, error replies |
| `src/verify.ts` | Pipeline, `quoteInSource`, `phoneInEvidence` |
| `src/evidence.ts` | Evidence store and Firecrawl / Apify fetchers |
| `src/phone.ts` | Cartesia `POST /agents/calls`, polling `GET /agents/calls/{id}`, transcript → evidence |
| `src/llm.ts` | Claude structured-output helper (zod-validated) and image blocks |
| `src/join.ts` | Join page with QR code |
| `scripts/quote-test.ts` | Unit checks for the guarantee (`npm test`) |
| `scripts/try.ts` | Runs the full pipeline from a terminal (`npm run try -- "<claim>"`) |

## 4. Platform facts we rely on (verified tonight)

- **Photon Beta**
  - Project `pho_prj_01m67q51d8fap8x5tscbrkv21z`, Messaging Free plan, $100 credit.
  - **Shared lines** only: 25 seats, 1:1 chats only, text and images.
  - The user must text first. After that we can message them freely (this is what enables live call updates).
  - No tapbacks, effects or groups on Beta. Dedicated lines need the Business plan, so they're out.
  - Events: Socket.IO at `https://api.photon.codes`, path `/v1/projects/{id}/events/ws`, then `emit("subscribe",{startSeq})`, then `delivery(event, {seq, replyExpected})`.
  - Inbound: `event.type === "message.received"`, `event.data.object` = `{id, space, sentBy, receivedBy, content}`.
  - Send: `POST /v1/projects/{id}/messages` with an `Idempotency-Key` header and body `{spaceId, senderId: receivedBy.id, content:{type:"text",format:"plain",text}}`.
  - Join: `POST /v1/projects/{id}/platforms/imessage/assignments` `{handle}` returns `assignedPhoneNumber`.
- **Cartesia**
  - Free US number (1 slot).
  - Outbound call: `POST https://api.cartesia.ai/agents/calls` with headers `X-API-Key` and `Cartesia-Version: 2026-08-14`, body `{agent_id, from_number_id, outbound_calls:[{to_number, dynamic_variables}]}`.
  - The transcript comes from `GET /agents/calls/{id}`; `role:"user"` is the person who answered.
- **Apify:** existing Store actor `compass/crawler-google-places` via `run-sync-get-dataset-items`. Any custom actors are built in Apify AI.
- **Firecrawl v2:** `POST /v2/search` (with `scrapeOptions.formats:[{type:"markdown"}]`) and `POST /v2/scrape`.

## 5. Who does what

**Shokhabbos**
- [ ] Photon dashboard → Settings: create a project API key (`pho_sk_…`, read and write).
- [ ] Railway: New Project → Deploy from GitHub → this repo, branch `claude/inspiring-ride-3min99` → generate a public domain.
- [ ] Railway env vars: `PHOTON_API_KEY`, `ANTHROPIC_API_KEY`, `FIRECRAWL_API_KEY`, `APIFY_TOKEN`, `BASE_URL=<railway url>`, `LOG_EVENTS=1`. Later add the Cartesia vars.
- [ ] Open the Railway URL on your iPhone, join, tap "Open iMessage", send. Paste the `[photon]` log lines back if anything looks off.
- [ ] Claim credits: Anthropic $50, Firecrawl 10k. Photon $100 is done.

**Akmal (Cartesia Playground)**
- [ ] Provision a free Cartesia number.
- [ ] Create the agent "Receipts Caller": a natural Sonic voice and a fast LLM. Prompt:
  > You are an AI assistant calling {{business_name}} to verify one thing for a customer: {{question}}. Say up front that you're an AI assistant. Ask the question clearly once, ask one short follow-up if the answer is unclear, thank them, and end the call. Never state facts yourself.
- [ ] Enable the end-call system tool. Keep calls short, about 90 s.
- [ ] Hand over `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`, `CARTESIA_FROM_NUMBER_ID`. No webhook is needed; the server polls for the transcript.
- [ ] Be the "business" phone for the stage demo.

**Claude (code):** everything in `src/`, pushed to `claude/inspiring-ride-3min99`. Railway auto-deploys on each push.

## 6. Milestones

| # | Target | Milestone | Status |
|---|---|---|---|
| 0 | 6:45 | Code scaffold: pipeline, quote checker, phone, join page, tests | ✅ pushed |
| 0b | 7:05 | Public receipts page `/r/:id` (quotes highlighted in source, **blocked claims shown with reason**), `/live` stage counter, link check computed by code | ✅ pushed |
| 1 | 7:05 | Railway deploy live; first real iMessage round trip; confirm the event shape from logs | ⏳ needs keys and deploy |
| 2 | 7:20 | Join page tested by Akmal from scratch (QR → join → text) | ⏳ |
| 3 | 8:00 | Web verification tuned on real inputs: scam screenshot, claim, unverifiable question | ⏳ |
| 4 | 8:30 | Phone verification live: "call me" demo and evidence-sourced business number | ⏳ needs Cartesia |
| 5 | 8:50 | Stranger test with 2–3 other hackers, fixes, README, submission | ⏳ |

Cut order if late: phone to a real business → "call me" demo → screenshot input. Text verification with receipts is the minimum demo.

## 7. Test checklist

- [x] `npm test`: real quote passes; paraphrased, extended, too-short and invented quotes are rejected; invented phone numbers are rejected.
- [ ] `npm run try -- "USPS texted me my package is held, pay $1.99 at usps-redelivery.co"` → 🚩 with a quote from an official USPS page.
- [ ] Hallucination probes:
  - "What did Photon's CEO say yesterday?" → ❓, no invented quote.
  - "Apple acquired Firecrawl" → no ✅.
- [ ] Phone: "Call me and pretend to be Joe's Pizza, ask if they're open till 10" → phone rings, answer "yes until 11" → reply quotes "until 11" with a 📞 receipt.
- [ ] Two people texting at once, an emoji-only text, and a 500-word text don't crash it, and every message gets a reply.
- [ ] Stranger test from cellular data (not venue Wi-Fi, not localhost).

## 8. Open risks

- **Photon event shape:** taken from the OpenAPI/AsyncAPI spec, not seen live yet. Set `LOG_EVENTS=1` on the first run.
- **Speed:** Apify Maps can take 20–60 s. We send status texts while waiting. If it's too slow, rely on Firecrawl only for hours.
- **Seats:** 25 on the free plan, enough for judging. Upgrading to Messaging Pro ($25, 100 seats) needs the team's OK.
- **Cartesia free tier:** concurrency and minutes limits. The cap is 2 calls per person (`MAX_CALLS_PER_USER`).
- **HEIC photos:** we ask for a screenshot instead. iMessage screenshots are PNG.
