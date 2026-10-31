import express from "express";
import { enqueue } from "./agent.js";
import { cfg, logConfig } from "./config.js";
import { mountJoin } from "./join.js";
import { listen } from "./photon.js";
import { mountWeb } from "./web.js";

process.on("unhandledRejection", (err) => console.error("[process] unhandledRejection", err));
process.on("uncaughtException", (err) => console.error("[process] uncaughtException", err));

logConfig();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
mountJoin(app);
mountWeb(app);
app.listen(cfg.port, () => console.log(`[http] listening on :${cfg.port} (${cfg.baseUrl})`));

if (cfg.photon.apiKey) listen(enqueue);
else console.warn("[photon] PHOTON_API_KEY missing; iMessage listener not started");
