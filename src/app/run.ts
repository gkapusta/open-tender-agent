import type { RunOptions, RunResult } from "../core/types";
import { runPipeline } from "../core/pipeline";

export type {
  Config,
  EmailMessage,
  Lead,
  MatchResult,
  ProcessedLead,
  RunOptions,
  RunOverrides,
  RunResult,
  SourceName,
  Stats
} from "../core/types";

export async function runLeadAgent(options: RunOptions): Promise<RunResult> {
  return runPipeline(options);
}
