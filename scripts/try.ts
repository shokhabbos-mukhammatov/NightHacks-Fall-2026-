// Run the full verification pipeline from the terminal, without iMessage:
//   npm run try -- "Is Tartine Bakery in SF open right now?"
import { EvidenceStore } from "../src/evidence.js";
import { renderVerified } from "../src/format.js";
import { gather, understand, verifyWithEvidence } from "../src/verify.js";

const text = process.argv.slice(2).join(" ");
const plan = await understand(text, []);
console.log("PLAN", JSON.stringify(plan, null, 2));
if (plan.intent !== "verify") process.exit(0);
const store = new EvidenceStore();
await gather(plan, store, text, (s) => console.log("STATUS", s));
console.log(`EVIDENCE ${store.size} items:`, store.all().map((e) => `${e.id} ${e.kind} ${e.url ?? e.title}`));
const v = await verifyWithEvidence(plan.items.map((i) => i.claim).join("\n"), store);
console.log(`\n--- reply (kept ${v.claims.length}, dropped ${v.dropped}) ---\n`);
console.log(renderVerified(v));
