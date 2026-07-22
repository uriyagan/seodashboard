/**
 * Google Gemini client (runs in the Worker).
 * Text generation + Nano Banana 2 image generation.
 * Model IDs are overridable via env; defaults verified July 2026.
 */
import type { Env } from "../index";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function textModel(env: Env): string {
  return env.GEMINI_TEXT_MODEL || "gemini-3.1-pro-preview";
}
export function imageModel(env: Env): string {
  return env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"; // Nano Banana 2
}

export interface GeneratedArticle {
  title: string;
  content_html: string;
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
}

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    content_html: { type: "string" },
    focus_keyword: { type: "string" },
    seo_title: { type: "string" },
    meta_description: { type: "string" },
  },
  required: ["title", "content_html", "focus_keyword", "seo_title", "meta_description"],
};

async function callGemini(env: Env, model: string, body: unknown): Promise<any> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const res = await fetch(`${API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Generates a full blog article as structured JSON.
 * `systemPrompt` is the project's editable content_prompt.
 */
export async function generateArticle(
  env: Env,
  systemPrompt: string,
  topic: string,
  keywords: string[] = []
): Promise<GeneratedArticle> {
  const keywordLine =
    keywords.length > 0
      ? `מילות המפתח (ביטויי חיפוש) של העסק: ${keywords.join(", ")}. בחר את המתאימה ביותר לנושא הפוסט כ-focus_keyword (או נסח מתאימה אם אף אחת אינה מדויקת), ובנה את הפוסט סביבה.`
      : "";
  const prompt = [
    systemPrompt?.trim() || "כתוב מאמר בלוג איכותי, מקצועי ומותאם SEO בעברית.",
    "",
    `נושא הפוסט: ${topic}`,
    keywordLine,
    "",
    "החזר JSON עם השדות: title (כותרת), content_html (גוף הפוסט כ-HTML נקי עם <h2>/<h3>/<p>/<ul>),",
    "focus_keyword (מילת מפתח ראשית), seo_title (כותרת SEO עד ~60 תווים), meta_description (תיאור מטא עד ~155 תווים).",
    "כל הטקסט בעברית.",
  ].filter(Boolean).join("\n");

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: ARTICLE_SCHEMA,
      temperature: 0.8,
    },
  });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return JSON.parse(text) as GeneratedArticle;
}

/** Generates a list of new post-title ideas given existing titles. */
export async function generateIdeas(
  env: Env,
  systemPrompt: string,
  existingTitles: string[],
  count = 10
): Promise<string[]> {
  const prompt = [
    systemPrompt?.trim() || "אתה אסטרטג תוכן SEO לבלוג בעברית.",
    "",
    `להלן ${existingTitles.length} כותרות של פוסטים שכבר קיימים באתר:`,
    existingTitles.map((t) => `- ${t}`).join("\n") || "(אין עדיין פוסטים)",
    "",
    `הצע ${count} רעיונות לכותרות פוסטים חדשים ואיכותיים שעדיין לא נכתבו, רלוונטיים לאותו תחום.`,
    "אל תחזור על כותרות קיימות. החזר JSON: מערך של מחרוזות (כותרות בלבד), בעברית.",
  ].join("\n");

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: { type: "array", items: { type: "string" } },
      temperature: 0.9,
    },
  });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no ideas");
  const arr = JSON.parse(text) as string[];
  return arr.slice(0, count);
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

/**
 * Generates an image with Nano Banana 2.
 * `basePrompt` is the project's editable image_prompt; `specific` is the
 * per-post instruction. Returns raw base64 image data.
 */
export interface RefImage {
  base64: string;
  mimeType: string;
}

export async function generateImage(
  env: Env,
  basePrompt: string,
  specific: string,
  refs: RefImage[] = []
): Promise<GeneratedImage> {
  const hasRefs = refs.length > 0;
  const prompt = [
    basePrompt?.trim(),
    specific?.trim(),
    hasRefs ? "שלב את המוצר מהתמונה/ות המצורפות בתמונה שתיווצר, בצורה טבעית ומשולבת." : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const r of refs) {
    parts.push({ inlineData: { mimeType: r.mimeType || "image/png", data: r.base64 } });
  }

  const data = await callGemini(env, imageModel(env), {
    contents: [{ parts }],
    generationConfig: { responseModalities: ["IMAGE"] },
  });

  const respParts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const part of respParts) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
  }
  throw new Error("Nano Banana 2 returned no image");
}
