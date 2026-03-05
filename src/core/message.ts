import { z } from "zod";
import { callOpenAIJson } from "./openai";
import type { EmailMessage, Lead } from "./types";

const schema = z.object({
  subject: z.string(),
  body: z.string()
});

const prompt = [
  "You are a sales assistant generating outbound email copy.",
  "Return strict JSON: {subject, body}. No markdown fences.",
  "Follow the requested language and tone exactly.",
  "Make it a catchy, professional sales message that highlights the company's services and why they're a fit for the lead.",
  "Personalize using lead details (title/summary/region/buyer). If a detail is missing, omit it gracefully.",
  "If lead details are not in English, translate or paraphrase them into English before using them, so the message does not mix English with other languages.",
  "Structure:",
  "- Subject: 40–70 characters, specific and enticing.",
  "- Body: 2 short paragraphs + 2–4 bullet points of services/strengths, then a clear CTA question.",
  "Keep it concise (120–180 words) and avoid hypey claims or guarantees.",
  "End with a polite signature using the company name and website."
].join(" ");

export async function makeEmail(
  company: { name: string; website: string; services: string; address: string },
  lead: Lead,
  language: string,
  tone: string
): Promise<EmailMessage> {
  if (!process.env.OPENAI_API_KEY) {
    return { subject: "", body: "" };
  }

  try {
    const raw = await callOpenAIJson<unknown>(
      [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify({
            language,
            tone,
            company,
            lead: {
              title: lead.title,
              summary: lead.summary_src,
              contact_name: lead.contact_name,
              buyer_name: lead.buyer_name,
              country: lead.country,
              region: lead.region
            }
          })
        }
      ],
      { temperature: 0.6 }
    );

    return schema.parse(raw);
  } catch {
    return { subject: "", body: "" };
  }
}
