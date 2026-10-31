import { cfg } from "./config.js";
import { EvidenceStore } from "./evidence.js";

const CARTESIA = "https://api.cartesia.ai";
const VERSION = "2026-08-14";

export type CallRequest = {
  toNumber: string; // E.164
  businessName: string;
  question: string;
  sourceLabel: string; // where the number came from, for the receipt
};

export type CallResult =
  | { ok: true; transcriptLines: string[]; endedAt: Date; summary?: string }
  | { ok: false; reason: string };

export function phoneReady() {
  return Boolean(cfg.cartesia.apiKey && cfg.cartesia.agentId && cfg.cartesia.fromNumberId);
}

async function cartesia(path: string, init: RequestInit = {}) {
  const res = await fetch(`${CARTESIA}${path}`, {
    ...init,
    headers: {
      "X-API-Key": cfg.cartesia.apiKey!,
      "Cartesia-Version": VERSION,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Cartesia ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body as any;
}

const DONE = new Set(["completed", "failed", "ended", "canceled", "cancelled", "no_answer", "busy", "error"]);

/** Place the call, then poll until it ends (works even without a webhook configured). */
export async function placeCall(req: CallRequest, onStatus: (s: string) => void): Promise<CallResult> {
  const started = await cartesia("/agents/calls", {
    method: "POST",
    body: JSON.stringify({
      agent_id: cfg.cartesia.agentId,
      from_number_id: cfg.cartesia.fromNumberId,
      ringing_timeout_seconds: 30,
      outbound_calls: [
        { to_number: req.toNumber, dynamic_variables: { business_name: req.businessName, question: req.question } },
      ],
    }),
  });
  const first = started?.calls?.[0];
  if (!first || first.error) return { ok: false, reason: `the call couldn't start (${JSON.stringify(first?.error ?? "unknown")})` };
  const callId: string = first.agent_call_id;
  console.log(`[phone] call ${callId} → ${req.toNumber}`);

  let announcedLive = false;
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    let call: any;
    try {
      call = await cartesia(`/agents/calls/${callId}`);
    } catch (err) {
      console.warn("[phone] poll failed:", (err as Error).message);
      continue;
    }
    const status = String(call.status ?? "").toLowerCase();
    if (!announcedLive && (call.start_time || status === "started" || status === "in_progress")) {
      announcedLive = true;
      onStatus("🔊 They picked up, asking now…");
    }
    if (call.end_time || DONE.has(status)) {
      const transcript: { role: string; text?: string | null }[] = call.transcript ?? [];
      const lines = transcript
        .filter((t) => t.text && (t.role === "user" || t.role === "assistant"))
        .map((t) => `${t.role === "user" ? "Business" : "Receipts caller"}: ${t.text!.trim()}`);
      if (!lines.some((l) => l.startsWith("Business:"))) {
        return { ok: false, reason: status === "failed" ? `the call failed${call.error_message ? ` (${call.error_message})` : ""}` : "nobody answered" };
      }
      return { ok: true, transcriptLines: lines, endedAt: call.end_time ? new Date(call.end_time) : new Date(), summary: call.summary ?? undefined };
    }
  }
  return { ok: false, reason: "the call didn't finish within 4 minutes" };
}

/** Store the transcript so the normal quote-checked pipeline can cite it. */
export function addTranscriptEvidence(store: EvidenceStore, req: CallRequest, result: Extract<CallResult, { ok: true }>) {
  const time = result.endedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return store.add({
    kind: "call",
    title: `📞 Phone call to ${req.businessName} (${req.toNumber}, ${req.sourceLabel}) at ${time}`,
    phone: req.toNumber,
    text: result.transcriptLines.join("\n"),
  });
}
