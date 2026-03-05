import type { Config, Lead } from "../types";
import type { Logger } from "../logger";
import { fetchTed } from "./ted";

export async function fetchBySource(config: Config, logger: Logger): Promise<Record<string, Lead[]>> {
  const out: Record<string, Lead[]> = {};

  if (config.sources.enabled.includes("TED")) {
    logger.debug("TED fetch started");
    try {
      out.TED = await fetchTed(config);
      logger.debug(`TED fetch completed with ${out.TED.length} leads`);
    } catch (error) {
      logger.error(`TED fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      out.TED = [];
    }
  }

  return out;
}
