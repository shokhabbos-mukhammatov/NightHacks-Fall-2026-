import { randomBytes } from "node:crypto";
import type { Evidence } from "./evidence.js";

export type BlockedClaim = { text: string; quote: string; evidenceId: string; reason: "quote_not_in_source" | "quote_does_not_support" | "unknown_source" };

export type Report = {
  id: string;
  createdAt: string;
  question: string;
  verdict: string;
  kept: { text: string; quote: string; evidence: Evidence }[];
  blocked: BlockedClaim[];
  unverified: string[];
  evidence: Evidence[];
};

const reports = new Map<string, Report>();

export const stats = {
  checks: 0,
  claimsKept: 0,
  claimsBlocked: 0,
  calls: 0,
  recent: [] as { verdict: string; question: string; at: string; kept: number; blocked: number }[],
};

export function saveReport(r: Omit<Report, "id" | "createdAt">): Report {
  const report = { ...r, id: randomBytes(5).toString("hex"), createdAt: new Date().toISOString() };
  reports.set(report.id, report);
  stats.checks++;
  stats.claimsKept += r.kept.length;
  stats.claimsBlocked += r.blocked.length;
  stats.recent.unshift({ verdict: r.verdict, question: r.question.slice(0, 140), at: report.createdAt, kept: r.kept.length, blocked: r.blocked.length });
  stats.recent.length = Math.min(stats.recent.length, 12);
  // Keep memory bounded during a long night of demos.
  if (reports.size > 2000) reports.delete(reports.keys().next().value!);
  return report;
}

export function getReport(id: string) {
  return reports.get(id);
}
