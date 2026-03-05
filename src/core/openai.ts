import { withRetry } from "./retry";
import { fetchWithTimeout } from "./http";

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5-mini";
const OPENAI_TIMEOUT_MS = 60_000;

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class OpenAIHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`OpenAI request failed: ${status} ${body}`);
  }
}

function cleanJson(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isRetriableOpenAiError(error: unknown): boolean {
  if (!(error instanceof OpenAIHttpError)) {
    return true;
  }
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function isTemperatureError(body: string): boolean {
  const normalized = body.toLowerCase();
  if (!normalized.includes("temperature")) {
    return false;
  }
  return /(unsupported|not\s+support|does\s+not\s+support|invalid|not\s+allowed)/i.test(normalized);
}

function isModelUnavailableError(body: string): boolean {
  const normalized = body.toLowerCase();
  if (!normalized.includes("model")) {
    return false;
  }
  return /(does\s+not\s+exist|do\s+not\s+have\s+access|not\s+found|not\s+available)/i.test(normalized);
}

export async function callOpenAI(
  messages: OpenAIMessage[],
  opts: { model?: string; temperature?: number } = {}
): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const model = opts.model ?? process.env.LEADAGENT_MODEL ?? DEFAULT_MODEL;
  const fallbackModel = process.env.LEADAGENT_FALLBACK_MODEL ?? DEFAULT_MODEL;
  const resolveTemperature = (targetModel: string, forceNoTemperature = false): number | undefined => {
    if (forceNoTemperature) return undefined;
    if (/^gpt-5/i.test(targetModel)) {
      if (opts.temperature === undefined) return undefined;
      return opts.temperature === 1 ? 1 : undefined;
    }
    return opts.temperature ?? 0.2;
  };

  const request = async (targetModel: string, forceNoTemperature = false): Promise<unknown> =>
    withRetry(
      async () => {
        const temperature = resolveTemperature(targetModel, forceNoTemperature);
        const payload: { model: string; messages: OpenAIMessage[]; temperature?: number } = {
          model: targetModel,
          messages
        };
        if (temperature !== undefined) {
          payload.temperature = temperature;
        }

        const response = await fetchWithTimeout(
          API_URL,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          },
          OPENAI_TIMEOUT_MS
        );

        if (!response.ok) {
          throw new OpenAIHttpError(response.status, await response.text());
        }

        return response.json();
      },
      {
        shouldRetry: (error) => isRetriableOpenAiError(error)
      }
    );

  try {
    return await request(model);
  } catch (error) {
    const isTempMismatch =
      error instanceof OpenAIHttpError &&
      error.status === 400 &&
      isTemperatureError(error.body);

    if (isTempMismatch) {
      return request(model, true);
    }

    const isModelError =
      error instanceof OpenAIHttpError &&
      (error.status === 404 || error.status === 400) &&
      isModelUnavailableError(error.body);

    if (isModelError && model !== fallbackModel) {
      return request(fallbackModel);
    }

    throw error;
  }
}

export async function callOpenAIJson<T>(
  messages: OpenAIMessage[],
  opts: { model?: string; temperature?: number } = {}
): Promise<T> {
  const data = (await callOpenAI(messages, opts)) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response missing content");
  }

  return JSON.parse(cleanJson(content)) as T;
}
