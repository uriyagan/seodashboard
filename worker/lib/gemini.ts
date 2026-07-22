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

export interface LinkTargetInput {
  type: string; // post | page | product_cat | product_tag
  title: string;
  url: string;
}
export interface LinkSuggestion {
  anchor: string;
  target_url: string;
  target_title: string;
  target_type: string;
  reason: string;
}

const TYPE_LABEL: Record<string, string> = {
  post: "פוסט",
  page: "עמוד",
  product_cat: "קטגוריית מוצר",
  product_tag: "תגית מוצר",
};

const LINK_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          anchor: { type: "string" },
          target_url: { type: "string" },
          target_title: { type: "string" },
          target_type: { type: "string" },
          reason: { type: "string" },
        },
        required: ["anchor", "target_url", "target_title", "target_type", "reason"],
      },
    },
  },
  required: ["suggestions"],
};

/**
 * AI internal-link suggestions: Gemini reads the post and the site's existing
 * destinations (pages, product categories/tags, other posts) and proposes
 * contextual links that add real value — each with an exact anchor phrase from
 * the post and a short reason. Returns raw suggestions (validated by the route).
 */
export async function suggestInternalLinks(
  env: Env,
  postTitle: string,
  postText: string,
  targets: LinkTargetInput[]
): Promise<LinkSuggestion[]> {
  if (!targets.length || postText.trim().length < 40) return [];

  const catalog = targets
    .map((t) => `- [${TYPE_LABEL[t.type] ?? t.type}] "${t.title}" → ${t.url}`)
    .join("\n");

  const prompt = [
    "אתה מומחה קישורים פנימיים (Internal Linking) ל-SEO בעברית. המטרה: להוסיף לפוסט קישורים פנימיים שיש להם ערך אמיתי לגולש — הקשריים, טבעיים, ומדויקים.",
    "",
    "להלן היעדים הקיימים באתר (עמודים, קטגוריות ותגיות מוצר בחנות, ופוסטים אחרים):",
    catalog,
    "",
    `כותרת הפוסט: ${postTitle}`,
    "תוכן הפוסט:",
    '"""',
    postText,
    '"""',
    "",
    "כללים:",
    "1. הצע קישור רק כשהוא באמת רלוונטי ומועיל לגולש בהקשר של הפסקה — לא סתם כי מילה מופיעה.",
    "2. עוגן הקישור (anchor) חייב להיות מחרוזת שמופיעה **מילה-במילה** בתוך תוכן הפוסט (העתק מדויק, כולל אותיות יחס). עדיף ביטוי בן 2-5 מילים, לא מילה בודדת גנרית ולא משפט שלם.",
    "3. כל עוגן פעם אחת בלבד. אל תציע קישור לאותו יעד פעמיים.",
    "4. התאם כל עוגן ליעד ההקשרי ביותר: הזכרת סוג מוצר → קטגוריית/תגית המוצר; נושא שיש עליו פוסט → הפוסט; מידע כללי → העמוד.",
    "5. איכות על פני כמות — עד 8 הצעות, רק כאלה עם ערך ברור. אם אין התאמות טובות, החזר מערך ריק.",
    "6. לכל הצעה כתוב reason קצר בעברית שמסביר את הערך לגולש.",
    "",
    "החזר JSON: { suggestions: [{ anchor, target_url, target_title, target_type, reason }] }. target_url חייב להיות אחד מה-URL-ים ברשימה.",
  ].join("\n");

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: LINK_SCHEMA,
      temperature: 0.3,
    },
  });

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];
  try {
    return (JSON.parse(text) as { suggestions: LinkSuggestion[] }).suggestions ?? [];
  } catch {
    return [];
  }
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
