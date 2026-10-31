import type { Verified } from "./verify.js";
import { sourceLabel } from "./verify.js";

const HEADLINE: Record<Verified["verdict"], string> = {
  scam: "🚩 Scam",
  likely_scam: "🚩 Likely a scam",
  legit: "✅ Looks legit",
  true: "✅ True",
  false: "❌ False",
  mixed: "⚖️ Partly true",
  unverified: "❓ Couldn't verify",
};

function clip(s: string, n = 160) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function renderVerified(v: Verified): string {
  const lines: string[] = [HEADLINE[v.verdict]];

  // Number each distinct source once so receipts can be referenced.
  const sources: Verified["claims"][number]["evidence"][] = [];
  const refOf = (e: (typeof sources)[number]) => {
    let i = sources.findIndex((s) => s.id === e.id);
    if (i === -1) i = sources.push(e) - 1;
    return i + 1;
  };

  if (v.claims.length) {
    lines.push("");
    for (const c of v.claims) {
      const who = c.evidence.kind === "input" ? "your message" : `[${refOf(c.evidence)}]`;
      lines.push(`• ${c.text}`);
      lines.push(`  “${clip(c.quote)}” ${who}`);
    }
  }

  if (v.unverified.length) {
    lines.push("");
    lines.push(`❓ Couldn't confirm: ${v.unverified.slice(0, 3).join("; ")}`);
  }

  if (sources.length) {
    lines.push("");
    lines.push("🧾 Receipts");
    sources.forEach((s, i) => {
      if (s.kind === "call") lines.push(`${i + 1}. ${s.title}`);
      else lines.push(`${i + 1}. ${sourceLabel(s)}${s.url ? ` ${s.url}` : ""}`);
    });
  } else if (v.verdict === "unverified") {
    const looked = v.checked.slice(0, 4).map((e) => sourceLabel(e));
    lines.push("");
    lines.push(
      looked.length
        ? `I checked ${looked.join(", ")} but none of them proved it either way, so I won't guess.`
        : "I couldn't find any source that proves it either way, so I won't guess.",
    );
  }

  if (v.call) {
    lines.push("");
    lines.push(
      `📞 Want me to call ${v.call.businessName} at ${v.call.phone} (number from their ${sourceLabel(v.call.source)}) and ask "${v.call.question}"? Reply "call".`,
    );
  }

  return lines.join("\n");
}

export const ONBOARDING =
  "Hey, I'm Receipts 🧾 I never guess, and every answer comes with proof.\n\n" +
  "Try me:\n" +
  "• Forward a sketchy text or send a screenshot of it\n" +
  "• \"Is Tartine Bakery open right now?\" (I'll call them if I have to)\n" +
  "• Paste any claim from a group chat\n" +
  "• \"Call me and pretend to be Joe's Pizza\" to test my phone check on yourself";
