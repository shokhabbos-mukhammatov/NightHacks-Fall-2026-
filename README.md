# Ask the Bro 🤙 — the bro who never lies to you

Text Bro anything you're not sure is true: a sketchy text, a screenshot, a group-chat rumor, "is Tartine open right now?".
He texts back like your friend would, short and chill, but **he never makes stuff up.** He checks primary sources, and **when the web isn't enough, he calls the real place and asks.**
Every answer comes with receipts 🧾: a verbatim quote and link, or a quote from the phone call. If he can't prove it, he says so instead of guessing.

> "nah bro, not halal certified 😬 • they said on yelp their meat's not certified halal"
> receipts 🧾 → the quote highlighted inside the real Yelp page, plus every claim Bro tossed because he couldn't back it up.

Built at Night Hack (Founders, Inc.) on Oct 30, 2026. **Everything in this repo was written after kickoff.**

## How the "no hallucination" guarantee works

What we guarantee: **every fact Bro states is backed by a verbatim quote from a source it actually fetched or heard.**

1. **Understand.** Claude reads the message (and screenshot) and lists what needs checking. It answers nothing here.
2. **Gather evidence.** Each item is stored with an id:
   - Firecrawl search and scrape: official pages, plus the suspicious link itself
   - Apify Google Maps: the official listing with phone and hours
   - Cartesia call transcript: what the business actually said
3. **Answer only from evidence.** Claude must return structured JSON where every claim cites an evidence id and an exact quote.
4. **Exact-quote check (plain code, no AI).** The quote must appear word for word in the stored source, or the claim is deleted (`quoteInSource` in `src/verify.ts`). On a phone transcript, only the business's own lines count.
5. **Independent support check.** A second Claude pass checks that each quote actually supports its claim; unsupported claims are deleted.
6. **Reply.** Only the claims that survive are sent, in Bro's voice, each with its receipt. If nothing survives, Bro says he couldn't prove it and lists where he looked. Bro's headlines and status texts are fixed templates with no facts in them, so the casual voice never adds anything unchecked.

**Phone numbers are never invented.** Bro only dials a number that appears verbatim in fetched evidence, or the texter's own number in demo mode. Every call starts by saying it's an AI assistant.

What we don't claim: a source can itself be wrong, which would produce a wrong ✅. That's why the quote and link are always shown.

## Try it
Open the deployed URL, enter your iPhone number, and tap **Open iMessage**. Then:
- send a screenshot of a scam text
- ask "Is Tartine Bakery open right now?"
- text "Call me and pretend to be Joe's Pizza. Ask if they're open till 10" to test the phone check on yourself

## Stack
- **Photon** (Beta): iMessage shared lines; Socket.IO events in, HTTP API out
- **Claude** (model set by `ANTHROPIC_MODEL`, structured outputs): intake, cited answering, support audit
- **Firecrawl**: web search and scraping
- **Apify**: Google Maps listing actor
- **Cartesia**: outbound voice agent and call transcripts

## Docs
- [Build plan, architecture and status](docs/PLAN.md)
- [Demo script and submission draft](docs/DEMO_AND_SUBMISSION.md)

## Run
```bash
cp .env.example .env   # fill in keys
npm install
npm test               # quote/phone guarantee checks
npm run try -- "USPS texted me that my package is held and I need to pay \$1.99 at usps-redelivery.co"
npm start
```

### Cartesia agent setup (Playground)
- Prompt: *"You are an AI assistant calling {{business_name}} to verify one thing for a customer: {{question}}. Say up front that you're an AI assistant. Ask the question clearly once, ask one short follow-up if the answer is unclear, thank them, and end the call. Never state facts yourself."*
- Enable the end-call tool and keep calls short. Copy the agent id and phone number id into `.env`. The server polls the call for its transcript, so no webhook is required.
