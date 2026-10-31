import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { cfg } from "./config.js";

const client = new Anthropic();

export type UserContent = Anthropic.Beta.BetaContentBlockParam[];

/**
 * One structured-output call. The response is constrained to `jsonSchema` by the API and then
 * validated again with zod, so downstream code never sees a malformed shape.
 */
export async function askJSON<T>(opts: {
  system: string;
  content: UserContent;
  jsonSchema: Record<string, unknown>;
  zod: z.ZodType<T>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<T> {
  const params = {
    model: cfg.anthropicModel,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: [{ role: "user" as const, content: opts.content }],
    output_config: {
      effort: opts.effort ?? "low",
      format: { type: "json_schema" as const, schema: opts.jsonSchema },
    },
  };

  let msg: Anthropic.Beta.BetaMessage;
  try {
    // Server-side fallback: if a safety classifier declines, the API re-runs on a recommended model.
    msg = await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as any);
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      // e.g. fallbacks unsupported for a configured model — retry plain.
      msg = await client.beta.messages.create(params as any);
    } else throw err;
  }

  if (msg.stop_reason === "refusal") throw new Error("model declined the request");
  if (msg.stop_reason === "max_tokens") throw new Error("model output was truncated");
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return opts.zod.parse(JSON.parse(text));
}

export function imageBlock(data: Buffer, mediaType: string): Anthropic.Beta.BetaImageBlockParam {
  const mt = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType) ? mediaType : "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";
  return { type: "image", source: { type: "base64", media_type: mt, data: data.toString("base64") } };
}
