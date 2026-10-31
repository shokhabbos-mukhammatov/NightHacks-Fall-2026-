import { cfg } from "./config.js";
import type { Verified } from "./verify.js";
import { sourceLabel } from "./verify.js";

/** Pick one of a few phrasings so the bro doesn't sound like a template. */
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// Headlines are fixed templates with NO facts in them — facts only come from verified claims.
const HEADLINE: Record<Verified["verdict"], readonly string[]> = {
  scam: ["bro that's a scam 🚩 don't click anything", "yeah no, that's a scam bro 🚩", "scam alert 🚩 don't touch that link bro"],
  likely_scam: ["bro this smells like a scam 🚩", "i'd stay away from this one bro 🚩", "big scam vibes here dude 🚩"],
  legit: ["you're good bro, looks legit ✅", "checked it, this one's legit ✅", "all good bratha, it's legit ✅"],
  true: ["yeah bro, that's true ✅", "facts bro ✅", "checked it, that's legit true ✅"],
  false: ["nah bro, that's cap ❌", "nope, not true bro ❌", "that's cap bratha ❌"],
  mixed: ["kinda bro, it's complicated ⚖️", "half true bro ⚖️", "ehh, sorta bro ⚖️"],
  unverified: [
    "honestly bro, couldn't find proof either way 🤷 not gonna make stuff up",
    "bro i couldn't prove it either way 🤷 so i'm not gonna guess",
    "no solid proof out there bro 🤷 i'd rather not guess",
  ],
};

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function shortSource(e: Verified["claims"][number]["evidence"]): string {
  if (e.kind === "call") return "said on the phone 📞";
  if (e.kind === "input") return "from your message";
  return sourceLabel(e);
}

/** Returns iMessage bubbles: [answer, follow-up?]. Keep each one phone-screen sized. */
export function renderVerified(v: Verified): string[] {
  const answer: string[] = [pick(HEADLINE[v.verdict])];

  const shown = v.claims.slice(0, 3);
  if (shown.length) {
    answer.push("");
    shown.forEach((c, i) => {
      // One short verbatim quote for punch on the top claim; the rest live on the receipts page.
      if (i === 0 && c.quote.length <= 90) {
        answer.push(`• ${c.text}`);
        answer.push(`  “${clip(c.quote, 90)}” (${shortSource(c.evidence)})`);
      } else answer.push(`• ${c.text} (${shortSource(c.evidence)})`);
    });
  } else if (v.checked.length) {
    const looked = [...new Set(v.checked.map((e) => sourceLabel(e)))].slice(0, 3);
    answer.push("", `looked at ${looked.join(", ")} and nothing proved it.`);
  }

  if (v.unverified.length && shown.length) {
    answer.push("", `still couldn't confirm: ${clip(v.unverified[0], 90)}`);
  }

  const follow: string[] = [];
  if (v.call) follow.push(`want me to just call ${v.call.businessName} and ask? say "call" 📞`);
  const tossed = v.dropped > 0 ? ` (tossed ${v.dropped} claim${v.dropped === 1 ? "" : "s"} i couldn't back up 🛡️)` : "";
  follow.push(`receipts 🧾 ${cfg.baseUrl}/r/${v.reportId}${tossed}`);

  return [answer.join("\n"), follow.join("\n")];
}

export const ONBOARDING =
  "yo, i'm Bro 🤙\n" +
  "send me anything you're not sure is true and i'll find you real proof. i never make stuff up.\n\n" +
  "try:\n" +
  "• a screenshot of a sketchy text\n" +
  "• \"is tartine open right now?\"\n" +
  "• a random invite or text from an unknown number 🕵️\n" +
  "• \"call me and pretend to be joe's pizza\" 😂";

export const SAY = {
  status: {
    scam: () => pick(["on it bro 🔎 checking the official sources", "ooh let me check that real quick 🔎", "hold up, checking if that's legit 🔎"]),
    business: () => pick(["on it bro 🔎", "say less, checking 🔎", "lemme look into that 🔎"]),
    fact: () => pick(["on it bro 🔎 only real sources", "lemme check the receipts 🔎", "checking, gimme a sec 🔎"]),
    investigate: () => pick(["ooh mystery 🕵️ lemme dig into this", "detective mode on 🕵️ gimme a sec bro", "say less, investigating 🕵️"]),
  },
  maps: (name: string) => `pulling up ${name}'s google listing real quick 📍`,
  slow: () => pick(["still digging, hang tight ⏳", "almost there bro ⏳", "sources are slow tonight, hang on ⏳"]),
  heic: "bro i can't read that photo format 😅 send a screenshot instead?",
  emailCaller: "i can only call US phone numbers bro, text me from your number to try the call 📞",
  noPhone: "phone calls are off rn bro, i can only check the web for now 🙏",
  callLimit: (n: number) => `you've used your ${n} test calls bro 😅 web checks are still unlimited tho`,
  calling: (name: string) => `📞 calling ${name} rn, gimme a sec`,
  callingYou: (name: string) => `📞 calling you now bro, pick up and play ${name} 😂 i'll only repeat what you actually say`,
  pickedUp: "they picked up 👀",
  callFailed: (reason: string) => `couldn't get an answer by phone bro (${reason}) 🤷 not gonna guess`,
  timeout: "my sources are taking forever bro ⏳ try again in a sec, or ask something more specific",
  error: "my bad bro, something glitched on my end 🙏 try again in a sec",
};
