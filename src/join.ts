import type { Express } from "express";
import QRCode from "qrcode";
import { cfg } from "./config.js";
import { createAssignment } from "./photon.js";
import { stats } from "./receipts.js";

export const page = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ask the Bro 🤙 the bro who never lies to you</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 17px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; margin: 0; display: grid; place-items: center; min-height: 100vh; background: #f4f1ea; color: #1c1c1e; }
  @media (prefers-color-scheme: dark) { body { background: #111; color: #f2f2f7; } .card { background: #1c1c1e !important; } input { background: #2c2c2e; color: inherit; } }
  .card { background: #fff; max-width: 420px; width: calc(100% - 32px); padding: 28px 24px; border-radius: 22px; box-shadow: 0 10px 40px rgba(0,0,0,.08); }
  h1 { margin: 0 0 4px; font-size: 30px; } .sub { margin: 0 0 20px; opacity: .7; }
  input { width: 100%; box-sizing: border-box; font-size: 18px; padding: 14px; border-radius: 12px; border: 1px solid #c7c7cc; margin: 6px 0 12px; }
  button, .btn { display: block; width: 100%; text-align: center; box-sizing: border-box; font-size: 18px; font-weight: 600; padding: 15px; border-radius: 14px; border: 0; background: #0a84ff; color: #fff; text-decoration: none; cursor: pointer; }
  ul { padding-left: 18px; margin: 18px 0 0; } li { margin: 4px 0; } small { opacity: .6; } .err { color: #ff453a; }
  .qr { display: block; margin: 18px auto 0; width: 180px; height: 180px; } code { font-size: 15px; }
  @media (max-width: 700px), (pointer: coarse) { .qrbox { display: none; } }
</style></head><body><div class="card">${body}</div></body></html>`;

export function mountJoin(app: Express) {
  app.get("/", async (_req, res) => {
    const qr = await QRCode.toDataURL(cfg.baseUrl, { margin: 1, width: 360 });
    res.type("html").send(
      page(`<h1>Ask the Bro 🤙</h1>
<p class="sub">The bro who never lies to you. Text him anything you're not sure is true, and every answer comes with receipts 🧾: a word-for-word quote from a real source, or he literally calls and asks.</p>
<form method="post" action="/join">
  <label for="h">Your iMessage phone number or Apple ID email</label>
  <input id="h" name="handle" required placeholder="+1 415 555 0123" autocomplete="tel" inputmode="email">
  <button type="submit">Text the Bro</button>
</form>
<ul><li>Screenshot a sketchy text: “bro is this a scam?”</li><li>“Is Tartine open right now?”</li><li>“Call me and pretend to be Joe's Pizza” 😂</li></ul>
${stats.checks ? `<p style="text-align:center"><small>🛡️ Bro refused to say ${stats.claimsBlocked} things he couldn't prove across ${stats.checks} checks tonight</small></p>` : ""}
<div class="qrbox"><img class="qr" src="${qr}" alt="QR code to open this page on your phone"><p style="text-align:center"><small>On a laptop? Scan this with your iPhone camera to join on your phone 📱</small></p></div>`),
    );
  });

  app.post("/join", async (req, res) => {
    const raw = String(req.body?.handle ?? "").trim();
    const handle = raw.includes("@") ? raw.toLowerCase() : normalizePhone(raw);
    if (!handle) {
      return res.status(400).type("html").send(page(`<h1>Hmm 🤔</h1><p class="err">That doesn't look like a US phone number or an email.</p><a class="btn" href="/">Try again</a>`));
    }
    try {
      const a = await createAssignment(handle);
      const line = a.assignedPhoneNumber;
      const sms = `sms:${line}&body=${encodeURIComponent("yo bro")}`;
      console.log(`[join] ${handle} → ${line}`);
      res.type("html").send(
        page(`<h1>You're in ✅</h1>
<p class="sub">Bro's number is <b>${line}</b>. Tap below and hit send. iMessage needs you to text first.</p>
<a class="btn" href="${sms}">Text the Bro</a>
<ul><li>Send him a scam text screenshot</li><li>Ask if a place is open right now</li><li>Paste a rumor from the group chat</li></ul>
<p><small>Text from the same number or Apple ID you entered (${escapeHtml(handle)}).</small></p>`),
      );
    } catch (err) {
      console.error("[join]", (err as Error).message);
      res.status(500).type("html").send(page(`<h1>Almost 😅</h1><p class="err">We couldn't add you right now (we may be at capacity). Find the Ask the Bro team at their table!</p><a class="btn" href="/">Back</a>`));
    }
  });
}

function normalizePhone(s: string): string | undefined {
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (s.trim().startsWith("+") && d.length >= 8 && d.length <= 15) return `+${d}`;
  return undefined;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
