# Custom Apify actor: "Receipts Link Inspector" (build it with Apify AI)

**Why:** scam texts almost always use a lookalike link registered days ago. Firecrawl can read the page, but it can't tell how old a domain is or whether it's on a phishing blocklist. This actor produces **deterministic, source-backed facts** about a link, which Receipts quotes as proof.

**Wiring:** once the actor is built and published, set `APIFY_LINK_ACTOR=<username>~receipts-link-inspector` in Railway. The bot calls it automatically for every link in a message. No code change is needed.

## Prompt to paste into Apify AI

> Build an Apify Actor named **receipts-link-inspector** in TypeScript (Node 22). It must finish in under 30 seconds.
>
> **Input** (JSON): `{ "url": string }`. The URL may be missing `https://`; add it if so.
>
> **What it does**, all in parallel with 8-second timeouts each; never fail the whole run if one step fails:
> 1. **Redirects:** request the URL without following redirects automatically, follow up to 5 hops manually, and record each hop's URL and status code. Record the final URL and final HTTP status.
> 2. **Domain registration:** take the registered domain of the *original* URL (e.g. `usps-redelivery.co` from `https://pay.usps-redelivery.co/x`; handle multi-part TLDs such as `.co.uk` with the `tldts` package). Look it up via RDAP at `https://rdap.org/domain/<domain>`. Extract the registration ("registration" eventAction) date, the registrar name, and compute the age in days from today.
> 3. **Blocklists:** check the URL and the domain against:
>    - URLhaus: `POST https://urlhaus-api.abuse.ch/v1/url/` with form field `url`, and `/v1/host/` with `host`
>    - OpenPhish community feed: `https://openphish.com/feed.txt`, a substring match on the domain
>    Record listed true/false for each, and the source URL.
> 4. **TLS:** if HTTPS, record the certificate issuer organization and validity start date.
> 5. **Page:** the final page's `<title>`.
>
> **Output:** push exactly ONE dataset item:
> ```json
> {
>   "inputUrl": "...", "finalUrl": "...", "finalStatus": 200,
>   "redirectChain": [{"url": "...", "status": 301}],
>   "domain": "usps-redelivery.co",
>   "registrationDate": "2026-10-21", "domainAgeDays": 9, "registrar": "...",
>   "rdapSource": "https://rdap.org/domain/usps-redelivery.co",
>   "tls": {"issuer": "...", "validFrom": "..."},
>   "blocklists": [{"list": "URLhaus", "listed": false, "source": "https://urlhaus.abuse.ch"}, {"list": "OpenPhish", "listed": true, "source": "https://openphish.com/feed.txt"}],
>   "pageTitle": "...",
>   "facts": ["...", "..."]
> }
> ```
> **`facts`** is the most important field: an array of short, plain-English sentences, each stating ONE fact that came directly from a lookup above, with no opinions and no guesses. Use exactly these templates, only for data that was actually retrieved:
> - `The domain {domain} was registered on {registrationDate}, {domainAgeDays} days ago, according to RDAP.`
> - `The domain {domain} is registered through {registrar}.`
> - `The link redirects to {finalUrl}.` (only if the final URL's host differs from the input's)
> - `The link {url} is listed as malicious on {list}.` / `The domain {domain} is not listed on {list}.`
> - `The page title is "{pageTitle}".`
> - `The website could not be reached (HTTP {status}).` or `The website could not be reached ({error}).`
>
> If a lookup fails, omit its fact; do not write a fact saying it's unknown. Use only standard fetch plus `tldts`, with no browser. Set the default run memory to 256 MB. Add a sample input of `{"url": "https://example.com"}`.

## Test after building

- Run it in Apify Console with `{"url": "https://example.com"}`. You should get one item with `facts` such as "The domain example.com was registered on 1995-08-14…".
- Copy the actor's full name (`username~receipts-link-inspector`) into the Railway variable `APIFY_LINK_ACTOR`.
