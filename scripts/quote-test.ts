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
