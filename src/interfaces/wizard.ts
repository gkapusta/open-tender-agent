import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import YAML from "yaml";
import { intro, outro, select, confirm, isCancel, cancel, note } from "@clack/prompts";
import chalk from "chalk";
import { MESSAGE_TONES, SUPPORTED_LANGUAGES } from "../core/languages";
import type { Config } from "../core/types";

function must<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled");
    process.exit(0);
  }
  return value as T;
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumber(input: unknown, fallback: number): number {
  const parsed = typeof input === "number" ? input : Number(asTrimmed(input));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toEnvLine(key: string, value: string): string {
  const safe = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
  return `${key}="${safe}"`;
}

function showSection(step: number, total: number, title: string, description: string): void {
  note(`${chalk.bold(title)}\n${chalk.dim(description)}`, `Step ${step}/${total}`);
}

async function promptText(
  message: string,
  options: { placeholder?: string; initialValue?: string; required?: boolean } = {}
): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const hint = options.initialValue ? ` [default: ${options.initialValue}]` : options.placeholder ? ` [example: ${options.placeholder}]` : "";
      const raw = await rl.question(`${chalk.cyan(">")} ${chalk.white(message)}${chalk.dim(hint)}: `);
      const value = asTrimmed(raw) || options.initialValue || "";
      if (!options.required || value.length > 0) return value;
      note("This field is required.", "Required field");
    }
  } finally {
    rl.close();
  }
}

async function promptRequiredText(
  message: string,
  placeholder?: string,
  initialValue?: string
): Promise<string> {
  return promptText(message, { placeholder, initialValue, required: true });
}

async function promptOptionalText(
  message: string,
  placeholder?: string,
  initialValue?: string
): Promise<string> {
  return promptText(message, { placeholder, initialValue, required: false });
}

async function promptRequiredSecret(message: string): Promise<string> {
  return promptText(`${message} (paste-friendly, input visible)`, { required: true });
}

async function promptOptionalSecret(message: string): Promise<string> {
  return promptText(`${message} (paste-friendly, input visible)`);
}

export async function runWizard(configPath = "./config.yaml", envPath = "./.env"): Promise<void> {
  intro(chalk.cyan("Open Tender Agent Setup Wizard"));
  note(
    `${chalk.dim("Keyboard:")} arrows + enter for menus\n${chalk.dim("Paste:")} supported for all text and secret fields`,
    "Tips"
  );

  if (existsSync(configPath)) {
    const ok = must(await confirm({ message: `${configPath} exists. Overwrite?`, initialValue: false }));
    if (!ok) {
      cancel("Wizard aborted. Config not overwritten.");
      process.exit(0);
    }
  }

  if (existsSync(envPath)) {
    const ok = must(await confirm({ message: `${envPath} exists. Overwrite?`, initialValue: false }));
    if (!ok) {
      cancel("Wizard aborted. .env not overwritten.");
      process.exit(0);
    }
  }

  const mode = must(
    await select({
      message: "Choose setup mode",
      options: [
        { value: "quick", label: "Quick (recommended)", hint: "sensible defaults" },
        { value: "advanced", label: "Advanced", hint: "full controls" }
      ]
    })
  ) as "quick" | "advanced";

  showSection(1, 5, "Company Profile", "Core info used to score leads and draft outreach.");
  const companyName = await promptRequiredText("Company name", "My Company");
  const website = await promptRequiredText("Company website", "https://example.com");
  const address = await promptRequiredText("Company address", "Main Street 1, Brussels, Belgium");
  const services = await promptRequiredText("Describe your services", "Electrical works, HVAC, renovation");

  const language = must(
    await select({
      message: "Message language",
      options: SUPPORTED_LANGUAGES.map((l) => ({ value: l.code, label: `${l.flag} ${l.name}` }))
    })
  ) as string;

  const tone = must(
    await select({
      message: "Message tone",
      options: MESSAGE_TONES.map((t) => ({ value: t.value, label: t.label }))
    })
  ) as string;

  const sources: Array<"TED"> = ["TED"];

  showSection(2, 5, "TED Source Settings", "Configure TED feed window and limits.");
  const tedDaysBack = parseNumber(mode === "quick" ? 7 : await promptOptionalText("TED days back", "7", "7"), 7);

  const tedLimit = parseNumber(mode === "quick" ? 200 : await promptOptionalText("TED limit", "200", "200"), 200);

  const tedCountryRaw =
    mode === "quick"
      ? "BEL"
      : await promptOptionalText("TED country filters (ISO3 comma-separated, empty for all)", "BEL,POL,DEU");
  const tedCountry = tedCountryRaw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  showSection(3, 5, "Matching Rules", "Tune score threshold and distance filters.");
  const minScore = parseNumber(mode === "quick" ? 0.55 : await promptOptionalText("Minimum match score (0..1)", "0.55", "0.55"), 0.55);
  const radius = parseNumber(mode === "quick" ? 100 : await promptOptionalText("Max distance (km)", "100", "100"), 100);
  const requireContact =
    mode === "quick"
      ? true
      : Boolean(must(await confirm({ message: "Require contact details", initialValue: true })));

  showSection(4, 5, "Output + Geocoding", "Control output path and geocoding behavior.");
  const csvPath =
    mode === "quick" ? "./out/leads.csv" : await promptRequiredText("CSV output path", undefined, "./out/leads.csv");
  const append = mode === "quick" ? true : Boolean(must(await confirm({ message: "Append CSV", initialValue: true })));
  const leadsEmail = await promptOptionalText("Leads email (CSV will be sent here)", "leads@example.com");

  const geocodeEmail = await promptRequiredText("Geocoding email (Nominatim requirement)", "ops@example.com");
  const geocodeCountryFallback =
    mode === "quick"
      ? true
      : Boolean(must(await confirm({ message: "Fallback to country-level geocoding when needed", initialValue: true })));

  const outputConfig: Config["output"] = {
    csv_path: csvPath,
    append
  };

  if (leadsEmail) {
    outputConfig.leads_email = leadsEmail;
  }

  const config: Config = {
    company: {
      name: companyName,
      website,
      address,
      language,
      tone,
      services
    },
    sources: {
      enabled: sources,
      ted: {
        days_back: tedDaysBack,
        country_filter: tedCountry,
        limit: tedLimit
      }
    },
    matching: {
      radius_km: radius,
      require_contact: requireContact,
      min_match_score: minScore
    },
    output: outputConfig,
    geocoding: {
      provider: "nominatim",
      email: geocodeEmail,
      country_fallback: geocodeCountryFallback
    }
  };

  showSection(5, 5, "API Credentials", "Paste-friendly secret prompts (input is visible).");
  const openAi = await promptRequiredSecret("OPENAI_API_KEY");
  const model =
    mode === "quick" ? "gpt-5-mini" : await promptRequiredText("LEADAGENT_MODEL", undefined, "gpt-5-mini");
  const matchModel =
    mode === "quick" ? "gpt-5-nano" : await promptRequiredText("LEADAGENT_MATCH_MODEL", undefined, "gpt-5-nano");
  const userAgent =
    mode === "quick"
      ? "LeadAgentTS/0.1 (+https://yourcompany.com)"
      : await promptRequiredText("LEADAGENT_USER_AGENT", undefined, "LeadAgentTS/0.1 (+https://yourcompany.com)");
  const stateDb =
    mode === "quick" ? "./state.db" : await promptRequiredText("LEADAGENT_STATE_DB", undefined, "./state.db");
  const resendKey = await promptOptionalSecret("RESEND_API_KEY");
  const statusEmail = await promptOptionalText("Status email (run summary + logs)", "ops@example.com");
  const fromEmail = await promptOptionalText("From email (Resend verified sender)", "noreply@yourdomain.com");

  note(
    [
      `Mode: ${mode}`,
      `Sources: ${sources.join(", ")}`,
      `TED: ${tedDaysBack}d, limit ${tedLimit}`,
      `CSV: ${csvPath} (${append ? "append" : "overwrite"})`,
      `Leads email: ${leadsEmail || "not set"}`,
      `Status email: ${statusEmail || "not set"}`,
      `From email: ${fromEmail || "not set"}`,
      `Config: ${configPath}`,
      `Env: ${envPath}`
    ].join("\n"),
    "Review"
  );

  const writeNow = must(await confirm({ message: "Write config.yaml and .env now?", initialValue: true }));
  if (!writeNow) {
    cancel("Wizard cancelled before saving.");
    process.exit(0);
  }

  writeFileSync(configPath, YAML.stringify(config), "utf-8");
  writeFileSync(
    envPath,
    [
      toEnvLine("OPENAI_API_KEY", openAi || "sk-your-api-key-here"),
      toEnvLine("LEADAGENT_MODEL", model || "gpt-5-mini"),
      toEnvLine("LEADAGENT_MATCH_MODEL", matchModel || "gpt-5-nano"),
      toEnvLine("LEADAGENT_USER_AGENT", userAgent || "LeadAgentTS/0.1 (+https://yourcompany.com)"),
      toEnvLine("LEADAGENT_STATE_DB", stateDb || "./state.db"),
      toEnvLine("RESEND_API_KEY", resendKey),
      toEnvLine("LEADAGENT_STATUS_EMAIL", statusEmail),
      toEnvLine("LEADAGENT_FROM_EMAIL", fromEmail)
    ].join("\n") + "\n",
    "utf-8"
  );

  note(`Config: ${configPath}\nEnv: ${envPath}`, "Saved");
  outro(chalk.green("Setup complete. Run: bun run src/interfaces/cli.ts run --dry-run --verbose"));
}
