import { cfg } from "./config.js";
import { EvidenceStore, withTimeout } from "./evidence.js";
import { ONBOARDING, renderVerified } from "./format.js";
import { imageBlock, type UserContent } from "./llm.js";
import { addTranscriptEvidence, phoneReady, placeCall, type CallRequest } from "./phone.js";
import { stats } from "./receipts.js";
import { downloadAttachment, sendText, setTyping, type Inbound } from "./photon.js";
import { gather, sourceLabel, toE164, understand, verifyWithEvidence } from "./verify.js";

type SpaceState = { greeted: boolean; callsUsed: number; pendingCall?: CallRequest };
const spaces = new Map<string, SpaceState>();
const queues = new Map<string, Promise<void>>();

const YES_CALL = /^\s*(call|yes|yep|yeah|sure|ok|okay|do it|call them|go|please)\b/i;

/** Serialize work per conversation so replies never interleave. */
export function enqueue(msg: Inbound) {
  const prev = queues.get(msg.spaceId) ?? Promise.resolve();
  const next = prev.then(() => handle(msg)).catch((err) => console.error("[agent] unhandled", err));
  queues.set(msg.spaceId, next);
}

async function handle(msg: Inbound) {
  const state = spaces.get(msg.spaceId) ?? { greeted: false, callsUsed: 0 };
  spaces.set(msg.spaceId, state);
  const say = (text: string) => sendText(msg.spaceId, msg.agentUserId, text).catch((e) => console.error("[send]", e.message));

  // Keep the typing bubble alive while we work.
  await setTyping(msg.spaceId, msg.agentUserId, true);
  const typingTimer = setInterval(() => setTyping(msg.spaceId, msg.agentUserId, true), 8000);

  try {
    console.log(`[agent] ${msg.senderHandle}: ${msg.text.slice(0, 200)} (+${msg.attachmentIds.length} att)`);

    if (state.pendingCall && YES_CALL.test(msg.text) && msg.attachmentIds.length === 0) {
      const req = state.pendingCall;
      state.pendingCall = undefined;
      return await runCall(req, state, say);
    }

    const images: UserContent = [];
    for (const id of msg.attachmentIds.slice(0, 3)) {
      try {
        const { data, mediaType } = await downloadAttachment(id);
        if (/heic|heif/i.test(mediaType)) {
          await say("I can't read HEIC photos yet. Could you send a screenshot instead? 📸");
          continue;
        }
        if (mediaType.startsWith("image/")) images.push(imageBlock(data, mediaType));
      } catch (err) {
        console.warn("[agent] attachment failed:", (err as Error).message);
      }
    }
    if (!msg.text && images.length === 0) {
      if (!state.greeted) {
        state.greeted = true;
        await say(ONBOARDING);
      }
      return;
    }

    const plan = await withTimeout(understand(msg.text, images), 45_000, "understanding");
    console.log("[agent] plan", JSON.stringify(plan).slice(0, 600));

    if (plan.intent === "smalltalk" || plan.items.length === 0) {
      await say(state.greeted ? plan.reply || ONBOARDING : ONBOARDING);
      state.greeted = true;
      return;
    }
    state.greeted = true;

    if (plan.intent === "call_me_demo") {
      const me = toE164(msg.senderHandle);
      const item = plan.items[0];
      if (!me) return await say("I can only call a US phone number, and you're texting me from an email address. Text me from your phone number to try the call demo 📞");
      return await runCall(
        {
          toNumber: me,
          businessName: item.businessName || "the business",
          question: item.phoneQuestion || item.claim,
          sourceLabel: "demo: your own number",
        },
        state,
        say,
        `📞 Calling you now. Pick up and play ${item.businessName || "the business"}. I'll only report what you actually say.`,
      );
    }

    await say(statusLine(plan));
    const store = new EvidenceStore();
    const slow = setTimeout(() => void say("⏳ Still digging through sources, almost there…"), 25_000);
    let result: Awaited<ReturnType<typeof verifyWithEvidence>>;
    try {
      await gather(plan, store, msg.text, (s) => void say(s));
      const question = plan.items.map((i) => i.claim).join("\n");
      result = await withTimeout(verifyWithEvidence(question, store), 75_000, "verification");
    } finally {
      clearTimeout(slow);
    }
    console.log(`[agent] verdict ${result.verdict}, ${result.claims.length} claims kept, ${result.dropped} dropped`);

    if (result.call && phoneReady()) {
      state.pendingCall = {
        toNumber: result.call.phone,
        businessName: result.call.businessName,
        question: result.call.question,
        sourceLabel: `number from ${sourceLabel(result.call.source)}`,
      };
    } else result.call = undefined;

    await say(renderVerified(result));
  } catch (err) {
    console.error("[agent] error", err);
    const timedOut = /timed out/.test((err as Error)?.message ?? "");
    await say(
      timedOut
        ? "⏳ My sources took too long to answer, and I won't guess without them. Try again in a moment, or ask something more specific."
        : "⚠️ Something broke on my side while checking. I'd rather say nothing than guess, so give it another try in a moment.",
    );
  } finally {
    clearInterval(typingTimer);
    void setTyping(msg.spaceId, msg.agentUserId, false);
  }
}

function statusLine(plan: Awaited<ReturnType<typeof understand>>) {
  const t = plan.items.map((i) => i.type);
  if (t.includes("scam")) return "🔎 Checking it against official sources. No guessing, give me a few seconds…";
  if (t.includes("live_business")) return "🔎 Checking the official listing. If the web can't prove it, I'll offer to call…";
  return "🔎 Looking for primary sources. I'll only tell you what I can prove…";
}

async function runCall(req: CallRequest, state: SpaceState, say: (t: string) => Promise<void>, intro?: string) {
  if (!phoneReady()) return say("📞 Phone checks aren't switched on right now, so I can only verify from the web for the moment.");
  if (state.callsUsed >= cfg.maxCallsPerUser) return say(`📞 You've used your ${cfg.maxCallsPerUser} test calls. Web checks are still unlimited!`);
  state.callsUsed++;
  stats.calls++;

  await say(intro ?? `📞 Calling ${req.businessName} at ${req.toNumber} (${req.sourceLabel}) to ask: "${req.question}"`);
  const result = await placeCall(req, (s) => void say(s));
  if (!result.ok) return say(`❓ Couldn't verify by phone: ${result.reason}. I won't guess.`);

  const store = new EvidenceStore();
  addTranscriptEvidence(store, req, result);
  const verified = await verifyWithEvidence(req.question, store);
  verified.call = undefined;
  await say(renderVerified(verified));
}
