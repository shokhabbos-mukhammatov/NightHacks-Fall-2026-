// Unit checks for the code-level guarantee: quotes must exist verbatim in the source.
import assert from "node:assert/strict";
import { phoneInEvidence, quoteInSource } from "../src/verify.js";

const src = `## Text Message Scams\nUSPS **will not** send customers text messages or e-mails without a customer first requesting the service with a tracking number, and it will NOT contain a link.\nSee [our FAQ](https://faq.usps.com) for more.`;

assert.equal(quoteInSource("USPS will not send customers text messages or e-mails", src), true, "real quote (through markdown bold)");
assert.equal(quoteInSource("“and it will NOT contain a link.”", src), true, "curly quotes + punctuation");
assert.equal(quoteInSource("See our FAQ for more", src), true, "markdown link text");
assert.equal(quoteInSource("USPS never sends text messages", src), false, "paraphrase rejected");
assert.equal(quoteInSource("USPS will not send customers text messages and charges no fees", src), false, "extended quote rejected");
assert.equal(quoteInSource("will not", src), false, "too-short quote rejected");
assert.equal(quoteInSource("The CEO said yesterday that", src), false, "invented quote rejected");

const ev = [{ id: "E1", kind: "maps" as const, title: "x", text: "Phone: (415) 487-2600", fetchedAt: "" }];
assert.ok(phoneInEvidence("+1 415-487-2600", ev), "number present in evidence");
assert.equal(phoneInEvidence("+1 415-555-0000", ev), undefined, "invented number rejected");

console.log("✅ quote + phone guarantees: all checks passed");

// Link extraction is deterministic (regex), so the domain fact can be quoted as proof.
import { extractLinks } from "../src/verify.js";
const links = extractLinks("USPS: your package is held. Pay $1.99 at https://usps-redelivery.co/pay?id=7 or visit www.example.com. Email me at a@b.com");
assert.deepEqual(links.map((l) => l.domain), ["usps-redelivery.co", "example.com"], "domains found, email skipped");
assert.equal(extractLinks("Version 2.1.3 costs $5.99").length, 0, "numbers aren't links");

// Receipts page highlights the quote inside its real source text.
import { _inContext } from "../src/web.js";
const html = _inContext("will not send customers text messages", src);
assert.ok(html.includes("<mark>"), "quote highlighted in context");

// Reply rendering never states anything beyond the kept claims.
import { renderVerified } from "../src/format.js";
const reply = renderVerified({
  verdict: "unverified", claims: [], dropped: 2, unverified: ["whether the CEO said it"], checked: [], reportId: "abc",
});
assert.ok(reply.startsWith("❓"), "no proof → ❓");
assert.ok(reply.includes("blocked 2 claims"), "blocked count shown");
console.log("✅ link extraction, receipts page, and reply rendering: all checks passed");
