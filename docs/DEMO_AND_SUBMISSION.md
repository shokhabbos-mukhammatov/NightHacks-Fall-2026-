# Demo script and submission draft

## 90-second live demo (no slides)

Setup: mirror the presenter's iPhone. Akmal's phone is on speaker as "the bakery". Rehearse twice and keep a pre-sent backup thread on screen in case of slow Wi-Fi.

| Time | Do | Say |
|---|---|---|
| 0–10 s | Show the iMessage thread with Receipts | "AI agents sound confident even when they're wrong. Receipts is an iMessage agent that's not allowed to say anything it can't prove." |
| 10–35 s | Forward a real scam-text screenshot | "Every bullet is a word-for-word quote from the official source. Our code deletes any claim whose quote isn't literally in the page, so it's checked by code, not by trusting the model." |
| 35–70 s | Text "Is [bakery] open right now?", reply "call" | "The web can't prove it's open right now, so it calls. The number comes from their Google listing, never from the model." Akmal answers live. "And the answer is quoted from the call." |
| 70–80 s | Ask something unprovable | "When it can't prove it, it says so and shows what it checked." |
| 80–90 s | Show the QR | "Scan, join in 10 seconds, and try to make it lie." |

## Submission form draft

**Project name:** Receipts: the iMessage agent that never makes things up

**One-liner:** Text Receipts anything you're unsure is true, like a scam text, a screenshot, a rumor, or "is this place open?". It checks primary sources, calls the real business when the web isn't enough, and every claim comes with a verbatim quote as a receipt.

**What we built tonight (everything after kickoff):**
- An iMessage agent on Photon shared lines, with Socket.IO events in and HTTP replies out. It shows typing and accepts screenshots.
- A verification pipeline:
  - Claude plans the checks.
  - Firecrawl and Apify gather evidence.
  - Claude answers with structured citations.
  - A **code-level verbatim quote check** deletes any claim whose quote isn't in its source.
  - An independent support audit runs on each remaining claim.
  - Replies use ❓ instead of guessing.
- Phone verification through a Cartesia voice agent:
  - It only dials numbers found in fetched evidence and discloses that it's an AI.
  - The transcript becomes quotable evidence; only the business's lines count.
  - A "call me" mode lets anyone test it on their own phone.
- A public join page with a QR code that registers testers on Photon and opens iMessage with the first text pre-filled.

**Tools used:** Photon (iMessage), Claude API (Anthropic), Firecrawl, Apify (Google Maps actor + our own "Receipts Link Inspector" actor built with Apify AI), Cartesia (voice agent), Railway, Claude Code.

**Existing before kickoff:** nothing. The repo was empty at kickoff.

**Live receipts board:** https://nighthacks-fall-2026-production.up.railway.app/live

**Demo / access instructions:**
1. Open **https://nighthacks-fall-2026-production.up.railway.app** on an iPhone (or scan the QR at our table).
2. Enter your iMessage phone number and tap **Open iMessage**, then send the pre-filled text.
3. Try:
   - a screenshot of a scam text
   - "Is Tartine Bakery open right now?"
   - "Call me and pretend to be Joe's Pizza, ask if they're open till 10"

**iMessage handle:** **+1 (628) 316-7976**. Testers must join at the URL above first; Photon shared lines only accept registered numbers, and the join page shows the exact line to text.

**Captain contact:** Shokhabbos Mukhammatov

**Repo:** https://github.com/shokhabbos-mukhammatov/NightHacks-Fall-2026-
