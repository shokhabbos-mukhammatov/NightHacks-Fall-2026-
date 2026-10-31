import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { cfg } from "./config.js";

const API = "https://api.photon.codes";

export type Inbound = {
  messageId: string;
  spaceId: string;
  /** Our agent's user id on this line — required as `senderId` when replying. */
  agentUserId: string;
  senderId: string;
  senderHandle: string;
  text: string;
  attachmentIds: string[];
};

async function api(path: string, init: RequestInit & { idempotent?: boolean } = {}) {
  if (!cfg.photon.apiKey) throw new Error("PHOTON_API_KEY is not set");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.photon.apiKey}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.idempotent ? { "Idempotency-Key": randomUUID() } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(`${API}/v1/projects/${cfg.photon.projectId}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Photon ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res;
}

export async function sendText(spaceId: string, senderId: string, text: string) {
  // iMessage bubbles get unwieldy past a few thousand chars; keep replies tight.
  const body = { spaceId, senderId, content: { type: "text", format: "plain", text: text.slice(0, 3500) } };
  await api("/messages", { method: "POST", body: JSON.stringify(body), idempotent: true });
}

export async function setTyping(spaceId: string, senderId: string, typing: boolean) {
  try {
    await api(`/spaces/${spaceId}/typing`, {
      method: "POST",
      body: JSON.stringify({ senderId, typing }),
      idempotent: true,
    });
  } catch (err) {
    console.warn("[photon] typing failed:", (err as Error).message);
  }
}

export async function downloadAttachment(attachmentId: string): Promise<{ data: Buffer; mediaType: string }> {
  const meta = (await (await api(`/attachments/${attachmentId}`)).json()) as { contentType?: string };
  const res = await api(`/attachments/${attachmentId}/content`);
  const data = Buffer.from(await res.arrayBuffer());
  return { data, mediaType: meta.contentType ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

export type Assignment = { assignedPhoneNumber: string; assignmentId: string; handle: string };

export async function createAssignment(handle: string, firstName?: string): Promise<Assignment> {
  const res = await fetch(`${API}/v1/projects/${cfg.photon.projectId}/platforms/imessage/assignments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.photon.apiKey}`,
      "Content-Type": "application/json",
      // Same handle → same key, so double-taps on the join page replay instead of erroring.
      "Idempotency-Key": `join:${handle.toLowerCase()}`,
    },
    body: JSON.stringify({ handle, ...(firstName ? { firstName } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return body as Assignment;
  // Already assigned → look it up so the join page can still show the right number.
  if (res.status === 409) {
    const existing = await findAssignment(handle);
    if (existing) return existing;
  }
  throw new Error(`assignment failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
}

async function findAssignment(handle: string): Promise<Assignment | undefined> {
  const res = await api(`/platforms/imessage/assignments?pageSize=200`);
  const body = (await res.json()) as { assignments?: Assignment[]; data?: { assignments?: Assignment[] } };
  const list = body.assignments ?? body.data?.assignments ?? [];
  return list.find((a) => a.handle?.toLowerCase() === handle.toLowerCase());
}

/** Flatten text + attachment ids out of text / attachment / group content. */
function collect(content: any, out: { text: string[]; attachments: string[] }) {
  if (!content || typeof content !== "object") return;
  if (content.type === "text" && typeof content.text === "string") out.text.push(content.text);
  else if (content.type === "attachment" && content.attachmentId) out.attachments.push(content.attachmentId);
  else if (content.type === "group" && Array.isArray(content.parts)) content.parts.forEach((p: any) => collect(p, out));
}

export function normalize(event: any): Inbound | undefined {
  if (event?.type !== "message.received") return;
  const m = event.data?.object;
  if (!m || m.platform !== "imessage" || m.status !== "received") return;
  const out = { text: [] as string[], attachments: [] as string[] };
  collect(m.content, out);
  const agentUserId = m.receivedBy?.id ?? m.addressedTo?.id;
  if (!agentUserId || !m.space?.id || !m.sentBy?.id) {
    console.warn("[photon] message missing ids, raw:", JSON.stringify(m).slice(0, 800));
    return;
  }
  return {
    messageId: m.id,
    spaceId: m.space.id,
    agentUserId,
    senderId: m.sentBy.id,
    senderHandle: m.sentBy.handle ?? "",
    text: out.text.join("\n").trim(),
    attachmentIds: out.attachments,
  };
}

export function listen(onMessage: (msg: Inbound) => void): Socket {
  let cursor = 0;
  const seen = new Set<string>();
  const socket = io(API, {
    path: `/v1/projects/${cfg.photon.projectId}/events/ws`,
    addTrailingSlash: false,
    transports: ["websocket"],
    extraHeaders: { Authorization: `Bearer ${cfg.photon.apiKey}` },
    autoConnect: false,
  });

  socket.on("connect", () => {
    socket.timeout(10_000).emit("subscribe", { startSeq: cursor }, (err: unknown, result: any) => {
      if (err) {
        console.error("[photon] subscribe timeout, reconnecting");
        socket.disconnect().connect();
        return;
      }
      if (!result?.ok) return console.error("[photon] subscribe rejected:", JSON.stringify(result));
      console.log(`[photon] subscribed (conn ${result.connectionId}, api ${result.apiVersion}, from seq ${cursor})`);
    });
  });

  socket.on("delivery", (event: any, meta: { seq: number; replyExpected: boolean }) => {
    if (meta?.replyExpected) socket.emit("reply", { eventId: event.id, status: 200 });
    if (typeof meta?.seq === "number") cursor = Math.max(cursor, meta.seq);
    if (seen.has(event.id)) return;
    seen.add(event.id);
    if (process.env.LOG_EVENTS) console.log("[photon] event", JSON.stringify(event).slice(0, 1500));
    const msg = normalize(event);
    if (msg) onMessage(msg);
  });

  socket.on("delivery_error", (e: any) => console.error("[photon] delivery_error", JSON.stringify(e)));
  socket.on("connect_error", (e) => console.error("[photon] connect_error", e.message));
  socket.on("disconnect", (reason) => console.warn("[photon] disconnected:", reason));
  socket.connect();
  return socket;
}
