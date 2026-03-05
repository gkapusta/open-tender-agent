import { afterEach, describe, expect, it } from "bun:test";
import { callOpenAI } from "../src/core/openai";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalFallback = process.env.LEADAGENT_FALLBACK_MODEL;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalApiKey;
  }

  if (originalFallback === undefined) {
    delete process.env.LEADAGENT_FALLBACK_MODEL;
  } else {
    process.env.LEADAGENT_FALLBACK_MODEL = originalFallback;
  }
});

describe("callOpenAI", () => {
  it("retries without temperature when provider rejects temperature field", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const payloads: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);

      if (payloads.length === 1) {
        return new Response("Unsupported value: 'temperature'", { status: 400 });
      }

      return jsonResponse({
        choices: [{ message: { content: "{}" } }]
      });
    }) as unknown as typeof fetch;

    const out = await callOpenAI([{ role: "user", content: "hello" }], {
      model: "gpt-4o-mini",
      temperature: 0.7
    });

    expect((out as { choices?: unknown[] }).choices).toHaveLength(1);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.temperature).toBe(0.7);
    expect("temperature" in payloads[1]).toBe(false);
  });

  it("falls back to fallback model only for model-availability errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LEADAGENT_FALLBACK_MODEL = "gpt-5-mini";

    const models: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { model?: string };
      models.push(payload.model ?? "");

      if (models.length === 1) {
        return new Response("The model does not exist", { status: 404 });
      }

      return jsonResponse({
        choices: [{ message: { content: "{}" } }]
      });
    }) as unknown as typeof fetch;

    await callOpenAI([{ role: "user", content: "hello" }], {
      model: "missing-model"
    });

    expect(models).toEqual(["missing-model", "gpt-5-mini"]);
  });

  it("does not fallback on authentication errors", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.LEADAGENT_FALLBACK_MODEL = "gpt-5-mini";

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("Invalid API key", { status: 401 });
    }) as unknown as typeof fetch;

    let error: unknown;
    try {
      await callOpenAI([{ role: "user", content: "hello" }], { model: "missing-model" });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(String(error)).toContain("401");
    expect(calls).toBe(1);
  });
});
