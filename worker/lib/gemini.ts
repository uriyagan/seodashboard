/**
 * Google Gemini client (runs in the Worker).
 * Text generation + Nano Banana 2 image generation.
 * Model IDs are overridable via env; defaults verified July 2026.
 *
 * Quality-first: primary text model stays gemini-3.1-pro-preview.
 * Cloudflare's ~100s proxy timeout means unrestricted HIGH thinking on long
 * Hebrew articles surfaces as `Gemini 524`. We therefore cap thinking on
 * Pro (MEDIUM for writing/ideas, LOW for light tasks) and only fall back to
 * gemini-3-flash-preview after a timeout — never as the default.
 *
 * Article writing is split: free-form HTML body (+ continuation on MAX_TOKENS)
 * then a tiny SEO-metadata JSON call. Length is owned by content_prompt only.
 */
import type { Env } from "../index";
import { type ContentLanguage } from "./contentLanguage";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Transient upstream / proxy failures worth retrying. */
const RETRYABLE = new Set([429, 500, 502, 503, 504, 524]);

export function textModel(env: Env): string {
  return env.GEMINI_TEXT_MODEL || "gemini-3.1-pro-preview";
}
/** Faster model used when Pro hits a gateway timeout. */
export function textFallbackModel(env: Env): string {
  return env.GEMINI_TEXT_FALLBACK_MODEL || "gemini-3-flash-preview";
}
export function imageModel(env: Env): string {
  return env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"; // Nano Banana 2
}

export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

interface CallGeminiOpts {
  /** Override model id (defaults to env text model). */
  model?: string;
  /** Gemini 3.x reasoning depth. Omit for image / non-thinking models. */
  thinkingLevel?: ThinkingLevel;
  /** Attempts including the first try. */
  retries?: number;
}

export interface GeneratedArticle {
  title: string;
  content_html: string;
  focus_keyword: string;
  seo_title: string;
  meta_description: string;
}

/** Small metadata blob only — never put the long article body in JSON (truncation → broken parse). */
const SEO_META_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    focus_keyword: { type: "string" },
    seo_title: { type: "string" },
    meta_description: { type: "string" },
  },
  required: ["title", "focus_keyword", "seo_title", "meta_description"],
};

const MAX_ARTICLE_CONTINUATIONS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pull visible text from a Gemini candidate (skip thought/reasoning parts). */
function extractCandidateText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p: any) => typeof p?.text === "string" && !p.thought)
    .map((p: any) => p.text as string)
    .join("");
}

function finishReason(data: any): string {
  return String(data?.candidates?.[0]?.finishReason ?? "");
}

function isTruncatedResponse(data: any): boolean {
  return /MAX_TOKENS/i.test(finishReason(data));
}

/**
 * Low-level Gemini generateContent call with retries on transient failures
 * (incl. Cloudflare 524 gateway timeouts on long Pro/thinking responses).
 */
async function callGemini(
  env: Env,
  body: Record<string, unknown>,
  opts: CallGeminiOpts = {}
): Promise<any> {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const model = opts.model || textModel(env);
  const retries = opts.retries ?? 2;

  // Merge thinkingLevel into generationConfig when requested (Gemini 3.x).
  const payload = { ...body };
  if (opts.thinkingLevel) {
    const gc = (payload.generationConfig as Record<string, unknown> | undefined) ?? {};
    payload.generationConfig = {
      ...gc,
      thinkingConfig: { thinkingLevel: opts.thinkingLevel },
    };
  }

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    const res = await fetch(`${API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json();

    const detail = await res.text().catch(() => "");
    const msg =
      res.status === 524 || /error code:\s*524/i.test(detail)
        ? `Gemini 524: הבקשה לקחה יותר מדי זמן (timeout של Cloudflare ~100ש'). המערכת תנסה שוב / תעבור אוטומטית למודל גיבוי.`
        : `Gemini ${res.status}: ${detail.slice(0, 300)}`;
    lastErr = new Error(msg);
    if (!RETRYABLE.has(res.status) || attempt === retries) break;
  }
  throw lastErr ?? new Error("Gemini call failed");
}

/**
 * Run a text generation call on the primary model; on gateway timeout,
 * retry once on the faster Flash fallback (quality trade-off beats failure).
 */
async function callGeminiText(
  env: Env,
  body: Record<string, unknown>,
  opts: { thinkingLevel?: ThinkingLevel; retries?: number } = {}
): Promise<any> {
  try {
    return await callGemini(env, body, {
      model: textModel(env),
      thinkingLevel: opts.thinkingLevel ?? "LOW",
      retries: opts.retries ?? 1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    const timedOut = /\b524\b|timeout|DEADLINE/i.test(msg);
    const fallback = textFallbackModel(env);
    if (!timedOut || fallback === textModel(env)) throw e;
    return callGemini(env, body, {
      model: fallback,
      thinkingLevel: "LOW",
      retries: 1,
    });
  }
}

/**
 * A structured content brief for an idea (spec §5). Produced by the idea
 * generator, shown in the UI, and passed back to the article writer so a post
 * follows the researched direction rather than just its title.
 * `seo_evidence_type` is set server-side (never by the model) from whether real
 * Search Console data was actually included in the research.
 */
export interface IdeaBrief {
  summary: string;
  angle: string;
  main_topics: string[];
  deep_dive_points: string[];
  target_audience: string;
  search_intent: string;
  reader_value: string;
  category_fit: string;
  primary_keyword: string;
  secondary_keywords: string[];
  journey_stage: "discovery" | "comparison" | "decision" | "post-purchase";
  seo_evidence_type: "external-data" | "qualitative-estimate";
}

/** Gemini responseSchema fragment for a brief (excludes seo_evidence_type — server-set). */
const IDEA_BRIEF_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    angle: { type: "string" },
    main_topics: { type: "array", items: { type: "string" } },
    deep_dive_points: { type: "array", items: { type: "string" } },
    target_audience: { type: "string" },
    search_intent: { type: "string" },
    reader_value: { type: "string" },
    category_fit: { type: "string" },
    primary_keyword: { type: "string" },
    secondary_keywords: { type: "array", items: { type: "string" } },
    journey_stage: {
      type: "string",
      enum: ["discovery", "comparison", "decision", "post-purchase"],
    },
  },
  required: [
    "summary", "angle", "main_topics", "deep_dive_points", "target_audience",
    "search_intent", "reader_value", "category_fit", "primary_keyword",
    "secondary_keywords", "journey_stage",
  ],
};

const JOURNEY_LABEL: Record<ContentLanguage, Record<string, string>> = {
  he: {
    discovery: "גילוי",
    comparison: "השוואה",
    decision: "החלטה",
    "post-purchase": "לאחר רכישה",
  },
  en: {
    discovery: "discovery",
    comparison: "comparison",
    decision: "decision",
    "post-purchase": "post-purchase",
  },
};

/** Real search data + content inventory assembled before idea generation (spec §4). */
export interface IdeaResearch {
  /** Search Console query rows - undefined when no GSC data is available. */
  gscQueries?: { query: string; clicks: number; impressions: number; position: number }[];
  existingPosts: { title: string; focus_keyword?: string | null }[];
  /** Titles of ALL ideas ever suggested (any status) - for dedup. */
  allIdeaTitles: string[];
  /** Project target keywords. Used for service-led ideas, not only shop categories. */
  keywords?: string[];
}

export interface ArticleContext {
  categoryName?: string;
  productNames?: string[];
  brief?: IdeaBrief;
  language?: ContentLanguage;
}

function langOf(value: ContentLanguage | undefined): ContentLanguage {
  return value === "en" ? "en" : "he";
}

/** Strip accidental markdown fences around HTML bodies. */
function cleanArticleHtml(raw: string): string {
  let html = raw.trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return html;
}

function buildArticleContextBlocks(
  systemPrompt: string,
  topic: string,
  keywords: string[],
  context: ArticleContext
): string[] {
  const lang = langOf(context.language);
  const en = lang === "en";
  const keywordLine =
    keywords.length > 0
      ? en
        ? `Business search keywords: ${keywords.join(", ")}. Pick the best match for this post as the focus_keyword (or phrase a better one if none is exact), and build the post around it.`
        : `מילות המפתח (ביטויי חיפוש) של העסק: ${keywords.join(", ")}. בחר את המתאימה ביותר לנושא הפוסט כ-focus_keyword (או נסח מתאימה אם אף אחת אינה מדויקת), ובנה את הפוסט סביבה.`
      : "";
  const categoryBlock = context.categoryName
    ? [
        "",
        en
          ? "This article is written for an ecommerce store."
          : "המאמר נכתב עבור אתר מסחר אלקטרוני (חנות).",
        en
          ? `Product category this article belongs to: ${context.categoryName}`
          : `קטגוריית המוצרים שאליה המאמר משויך: ${context.categoryName}`,
        context.productNames && context.productNames.length
          ? en
            ? `Top relevant products in the category (mention them naturally in the copy, without hard selling): ${context.productNames.join(", ")}`
            : `מוצרים מובילים ורלוונטיים בקטגוריה (התייחס אליהם באופן טבעי בתוכן, בלי לפרסם באגרסיביות): ${context.productNames.join(", ")}`
          : "",
        en
          ? "Take the category and products into account so the content stays relevant to what the store sells, not generic."
          : "יש להביא בחשבון את הקטגוריה ואת המוצרים כדי שהתוכן יהיה רלוונטי למוצרים הנמכרים באתר ולא גנרי.",
      ].filter(Boolean)
    : [];
  const b = context.brief;
  const briefBlock = b
    ? [
        "",
        en
          ? "Content brief - write the article following this direction:"
          : "בריף תוכן (Content Brief) - כתוב את המאמר לפי ההכוונה הזו:",
        en ? `Summary: ${b.summary}` : `תקציר: ${b.summary}`,
        en ? `Central angle: ${b.angle}` : `זווית מרכזית: ${b.angle}`,
        b.main_topics.length
          ? en
            ? `Main topics to cover: ${b.main_topics.join(" | ")}`
            : `נושאים מרכזיים לכיסוי: ${b.main_topics.join(" | ")}`
          : "",
        b.deep_dive_points.length
          ? en
            ? `Points to go deeper on: ${b.deep_dive_points.join(" | ")}`
            : `נקודות להעמקה: ${b.deep_dive_points.join(" | ")}`
          : "",
        en ? `Target audience: ${b.target_audience}` : `קהל יעד: ${b.target_audience}`,
        en ? `Search intent: ${b.search_intent}` : `כוונת חיפוש: ${b.search_intent}`,
        en
          ? `Practical value for the reader: ${b.reader_value}`
          : `ערך מעשי לקורא: ${b.reader_value}`,
        en
          ? `Primary keyword: ${b.primary_keyword} - weave it naturally into subheadings and the opening.`
          : `מילת מפתח ראשית: ${b.primary_keyword} - שילב אותה באופן טבעי בכותרות המשנה ובפתיח.`,
        b.secondary_keywords.length
          ? en
            ? `Secondary keywords and questions to weave in naturally: ${b.secondary_keywords.join(", ")}`
            : `מילות מפתח משניות ושאלות לשילוב טבעי: ${b.secondary_keywords.join(", ")}`
          : "",
        en
          ? `Customer-journey stage: ${JOURNEY_LABEL.en[b.journey_stage] ?? b.journey_stage}`
          : `שלב במסע הלקוח: ${JOURNEY_LABEL.he[b.journey_stage] ?? b.journey_stage}`,
        en
          ? "Follow the brief's direction - topics, angle, intent, and keywords - but write a flowing, natural article. Do not copy the brief wording verbatim and do not turn it into a mechanical bullet list."
          : "עקוב אחרי הכיוון של הבריף - הנושאים, הזווית, הכוונה והמילים - אבל כתוב מאמר זורם וטבעי. אל תעתיק את ניסוחי הבריף מילה במילה ואל תהפוך אותו לרשימת סעיפים מכנית.",
      ].filter(Boolean)
    : [];
  return [
    systemPrompt?.trim() ||
      (en
        ? "Write a high-quality, professional, SEO-optimized blog article in English."
        : "כתוב מאמר בלוג איכותי, מקצועי ומותאם SEO בעברית."),
    ...categoryBlock,
    ...briefBlock,
    "",
    en ? `Post topic: ${topic}` : `נושא הפוסט: ${topic}`,
    // When a brief exists its primary_keyword takes precedence over the generic list.
    b ? "" : keywordLine,
  ].filter(Boolean);
}

/**
 * Writes the article body as free-form HTML (not JSON). If Gemini hits
 * MAX_TOKENS mid-article, continues in a multi-turn loop — so length stays
 * governed only by the project's content_prompt, not by a system cap.
 */
async function generateArticleHtml(
  env: Env,
  contextBlocks: string[],
  lang: ContentLanguage
): Promise<string> {
  const en = lang === "en";
  const writePrompt = [
    ...contextBlocks,
    "",
    en
      ? "Now write the article body only as clean HTML using <h2>/<h3>/<p>/<ul>/<ol>/<li> (no <html>/<body>, no markdown, no JSON)."
      : "כתוב עכשיו את גוף המאמר בלבד כ-HTML נקי עם <h2>/<h3>/<p>/<ul>/<ol>/<li> (בלי <html>/<body>, בלי markdown, בלי JSON).",
    en
      ? "Start directly with an HTML tag. Article length is set only by the instructions above. Do not cut it shorter than what those instructions require."
      : "התחל ישירות בתג HTML. אורך המאמר נקבע לפי ההוראות למעלה בלבד. אל תקצר אותו מעבר למה שנדרש שם.",
    en ? "All article text must be in English." : "כל הטקסט בעברית.",
  ].join("\n");

  type Content = { role: string; parts: { text: string }[] };
  const contents: Content[] = [{ role: "user", parts: [{ text: writePrompt }] }];
  let html = "";

  for (let i = 0; i <= MAX_ARTICLE_CONTINUATIONS; i++) {
    const data = await callGeminiText(
      env,
      {
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 32768,
        },
      },
      // First pass: quality. Continuations: faster, less thinking overhead.
      { thinkingLevel: i === 0 ? "MEDIUM" : "LOW", retries: 1 }
    );

    const chunk = extractCandidateText(data);
    if (!chunk?.trim()) {
      if (html) break;
      throw new Error("Gemini returned no content");
    }

    html += i === 0 ? chunk : chunk;
    contents.push({ role: "model", parts: [{ text: chunk }] });

    if (!isTruncatedResponse(data)) break;
    if (i === MAX_ARTICLE_CONTINUATIONS) break;

    contents.push({
      role: "user",
      parts: [
        {
          text: en
            ? "Continue the article exactly from the stopping point. Return only the rest of the HTML. Do not repeat what was already written, no JSON, no explanations."
            : "המשך את המאמר בדיוק מנקודת העצירה. החזר רק את המשך ה-HTML. בלי לחזור על מה שכבר נכתב, בלי JSON, בלי הסברים.",
        },
      ],
    });
  }

  const cleaned = cleanArticleHtml(html);
  if (cleaned.length < 80) throw new Error("Gemini החזיר גוף מאמר ריק מדי");
  return cleaned;
}

/** Short structured SEO fields derived from the finished HTML (tiny JSON — safe). */
async function generateArticleSeoMeta(
  env: Env,
  topic: string,
  contentHtml: string,
  brief?: IdeaBrief,
  lang: ContentLanguage = "he"
): Promise<Omit<GeneratedArticle, "content_html">> {
  const en = lang === "en";
  // Cap context sent to meta call. Full article can be long. Head+tail is enough for SEO fields.
  const plain = contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const excerpt =
    plain.length <= 6000 ? plain : `${plain.slice(0, 3500)}\n…\n${plain.slice(-2000)}`;

  const prompt = [
    en
      ? "Based on the article below, return SEO metadata in English."
      : "על בסיס המאמר הבא, החזר מטא-דאטה SEO בעברית.",
    en ? `Original topic: ${topic}` : `נושא מקורי: ${topic}`,
    brief?.primary_keyword
      ? en
        ? `Preferred keyword from the brief (use it as focus_keyword unless it does not fit): ${brief.primary_keyword}`
        : `מילת מפתח מועדפת מהבריף (השתמש בה כ-focus_keyword אלא אם אינה מתאימה): ${brief.primary_keyword}`
      : "",
    "",
    en ? "Article content (plain text):" : "תוכן המאמר (טקסט):",
    excerpt,
    "",
    en
      ? "Return JSON: title (article title), focus_keyword, seo_title (up to ~60 characters), meta_description (up to ~155 characters)."
      : "החזר JSON: title (כותרת המאמר), focus_keyword, seo_title (עד ~60 תווים), meta_description (עד ~155 תווים).",
  ]
    .filter(Boolean)
    .join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: SEO_META_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    },
    { thinkingLevel: "LOW", retries: 1 }
  );

  const text = extractCandidateText(data);
  if (!text) throw new Error("Gemini לא החזיר מטא-דאטה לפוסט");
  try {
    const meta = JSON.parse(text) as Omit<GeneratedArticle, "content_html">;
    if (!meta.title?.trim()) meta.title = topic;
    if (!meta.focus_keyword?.trim()) {
      meta.focus_keyword = brief?.primary_keyword?.trim() || topic;
    }
    if (!meta.seo_title?.trim()) meta.seo_title = meta.title.slice(0, 60);
    if (!meta.meta_description?.trim()) {
      meta.meta_description = plain.slice(0, 155);
    }
    return meta;
  } catch {
    // Meta is optional-ish — never fail a good article on a tiny JSON glitch.
    return {
      title: topic,
      focus_keyword: brief?.primary_keyword?.trim() || topic,
      seo_title: topic.slice(0, 60),
      meta_description: plain.slice(0, 155),
    };
  }
}

/**
 * Generates a full blog article.
 * `systemPrompt` is the project's editable content_prompt (including length).
 * When `context` carries a product category + products, the article is written
 * around them so it stays catalog-relevant (spec §2.4).
 *
 * Architecture (avoids truncated-JSON bugs without capping length):
 * 1) Write body as free-form HTML, with automatic continuation on MAX_TOKENS.
 * 2) Derive SEO metadata in a separate small JSON call.
 */
export async function generateArticle(
  env: Env,
  systemPrompt: string,
  topic: string,
  keywords: string[] = [],
  context: ArticleContext = {}
): Promise<GeneratedArticle> {
  const lang = langOf(context.language);
  const contextBlocks = buildArticleContextBlocks(systemPrompt, topic, keywords, context);
  const content_html = await generateArticleHtml(env, contextBlocks, lang);
  const meta = await generateArticleSeoMeta(env, topic, content_html, context.brief, lang);
  return { ...meta, content_html };
}

/**
 * Renders the shared SEO-research prompt blocks (spec §4): real Search Console
 * queries when available (else an explicit qualitative-only instruction that
 * forbids inventing numbers), the existing-content inventory, and the full
 * dedup list with a semantic-overlap rule.
 */
function researchBlocks(research: IdeaResearch, lang: ContentLanguage): string[] {
  const en = lang === "en";
  const gsc = research.gscQueries;
  const seoBlock = gsc && gsc.length
    ? [
        en
          ? "Real Google Search Console data (last 90 days). Base your ideas on it:"
          : "נתוני חיפוש אמיתיים מ-Google Search Console (90 הימים האחרונים). התבסס עליהם:",
        gsc
          .map(
            (r) =>
              en
                ? `- "${r.query}" · ${r.clicks} clicks · ${r.impressions} impressions · avg position ${r.position.toFixed(1)}`
                : `- "${r.query}" · ${r.clicks} קליקים · ${r.impressions} הופעות · מיקום ממוצע ${r.position.toFixed(1)}`
          )
          .join("\n"),
        en
          ? "Ground primary and secondary keywords in real queries from the list when relevant. Queries with high impressions and an average position worse than 10 are strong content opportunities."
          : "בסס את מילות המפתח הראשיות והמשניות על שאילתות אמיתיות מהרשימה כשרלוונטי. שאילתות עם הרבה הופעות ומיקום ממוצע גבוה מ-10 הן הזדמנויות תוכן חזקות.",
      ]
    : [
        en
          ? "No external search data is available. Make a qualitative estimate of search potential only, based on likely search intents, common questions, and decision stages."
          : "אין נתוני חיפוש חיצוניים זמינים. בצע הערכה איכותנית בלבד של פוטנציאל החיפוש על בסיס כוונות חיפוש סבירות, שאלות נפוצות ושלבי קבלת החלטה.",
        en
          ? "**Do not invent search volumes, numbers, or quantitative data.** Explain in words only."
          : "**אסור להמציא נפחי חיפוש, מספרים או נתונים כמותיים.** נמק במילים בלבד.",
      ];
  const none = en ? "(none)" : "(אין)";
  const kws = (research.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  const keywordBlock = kws.length
    ? [
        "",
        en
          ? "Target search keywords for this business (prefer these as primary_keyword when they fit, and cover distinct themes from the list):"
          : "מילות המפתח שהעסק רוצה לדרג עליהן (העדף אותן כ-primary_keyword כשהן מתאימות, וכסה נושאים שונים מהרשימה):",
        kws.map((k) => `- ${k}`).join("\n"),
      ]
    : [];
  return [
    ...seoBlock,
    ...keywordBlock,
    "",
    en
      ? "Articles already on the site (title · primary keyword):"
      : "מאמרים שכבר קיימים באתר (כותרת · מילת מפתח ראשית):",
    research.existingPosts
      .map((p) => `- ${p.title}${p.focus_keyword ? ` · ${p.focus_keyword}` : ""}`)
      .join("\n") || none,
    "",
    en
      ? "Every idea ever suggested (including written and rejected). Do not suggest them again:"
      : "כל הרעיונות שהוצעו אי-פעם (כולל שנכתבו ושנדחו). אין להציע אותם שוב:",
    research.allIdeaTitles.map((t) => `- ${t}`).join("\n") || none,
    "",
    en
      ? "Avoid cannibalization: do not propose an idea that overlaps semantically with an existing title or a prior idea, even if the wording is different. Semantic overlap = the same core topic and the same search intent. If a similar topic already exists, skip it or propose a substantially different angle (different audience, different journey stage, or different format) and say so explicitly in the angle field."
      : "מנע קניבליזציה: אל תציע רעיון שחופף סמנטית לכותרת קיימת או לרעיון קודם, גם אם הניסוח שונה. חפיפה סמנטית = אותו נושא ליבה ואותה כוונת חיפוש. אם נושא דומה כבר קיים, דלג עליו או הצע זווית שונה מהותית (קהל אחר, שלב אחר במסע הלקוח, או פורמט אחר) וציין זאת במפורש בשדה angle.",
  ];
}

const BRIEF_INSTRUCTION: Record<ContentLanguage, string> = {
  he: "לכל רעיון החזר בריף מלא: summary (תקציר של 2-4 משפטים), angle (הזווית המרכזית), main_topics (3-5 נושאים מרכזיים), deep_dive_points (נקודות שכדאי להעמיק בהן), target_audience (קהל היעד), search_intent (כוונת החיפוש), reader_value (הערך המעשי לקורא), category_fit (מדוע הרעיון מתאים), primary_keyword (מילת מפתח ראשית), secondary_keywords (3-8 מילות מפתח או שאלות משניות), journey_stage (אחד מ: discovery / comparison / decision / post-purchase). כל הטקסט בעברית מלבד journey_stage.",
  en: "For each idea return a full brief: summary (2-4 sentences), angle (the central angle), main_topics (3-5 central topics), deep_dive_points (points worth going deeper on), target_audience, search_intent, reader_value (practical value for the reader), category_fit (why the idea fits), primary_keyword, secondary_keywords (3-8 secondary keywords or questions), journey_stage (one of: discovery / comparison / decision / post-purchase). All text in English except journey_stage.",
};

const BROCHURE_IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, brief: IDEA_BRIEF_SCHEMA },
        required: ["title", "brief"],
      },
    },
  },
  required: ["ideas"],
};

/**
 * Brochure-site fallback (no product catalog): generates detailed idea briefs
 * from the SEO research + existing content, without category assignment.
 */
export async function generateIdeas(
  env: Env,
  systemPrompt: string,
  research: IdeaResearch,
  count = 6,
  language: ContentLanguage = "he"
): Promise<{ title: string; brief: Omit<IdeaBrief, "seo_evidence_type"> }[]> {
  const lang = langOf(language);
  const en = lang === "en";
  const prompt = [
    systemPrompt?.trim() ||
      (en
        ? "You are an SEO content strategist for an English brochure website."
        : "אתה אסטרטג תוכן SEO לאתר תדמית בעברית."),
    en
      ? "Run a short SEO research based on the data below and produce detailed briefs for new content ideas."
      : "בצע מחקר SEO קצר על סמך הנתונים שלהלן והפק בריפים מפורטים לרעיונות תוכן חדשים.",
    "",
    ...researchBlocks(research, lang),
    "",
    en
      ? `Produce ${count} new, high-quality post ideas about the service or offering of the site (how-tos, comparisons, alternatives, problems you solve). Do not require a shop product category. ${BRIEF_INSTRUCTION.en}`
      : `הפק ${count} רעיונות לפוסטים חדשים ואיכותיים על השירות או המוצר שהאתר מציע (מדריכים, השוואות, חלופות, בעיות שאתם פותרים). אין צורך לשייך לקטגוריית מוצר בחנות. ${BRIEF_INSTRUCTION.he}`,
    en
      ? "In category_fit explain how the idea fits the site and its service. Return JSON: { ideas: [{ title, brief }] }."
      : "בשדה category_fit הסבר את ההתאמה לאתר ולשירות שהוא מציע. החזר JSON: { ideas: [{ title, brief }] }.",
  ].join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: BROCHURE_IDEAS_SCHEMA,
        temperature: 0.9,
        maxOutputTokens: 16384,
      },
    },
    { thinkingLevel: "MEDIUM" }
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no ideas");
  let parsed: { ideas: { title: string; brief: Omit<IdeaBrief, "seo_evidence_type"> }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini החזיר תשובה לא תקינה (ייתכן שהתשובה נחתכה)");
  }
  return (parsed.ideas ?? []).slice(0, count);
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

const TYPE_LABEL: Record<ContentLanguage, Record<string, string>> = {
  he: {
    post: "פוסט",
    page: "עמוד",
    product_cat: "קטגוריית מוצר",
    product_tag: "תגית מוצר",
  },
  en: {
    post: "post",
    page: "page",
    product_cat: "product category",
    product_tag: "product tag",
  },
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
  targets: LinkTargetInput[],
  language: ContentLanguage = "he"
): Promise<LinkSuggestion[]> {
  if (!targets.length || postText.trim().length < 40) return [];

  const lang = langOf(language);
  const en = lang === "en";
  const labels = TYPE_LABEL[lang];
  const catalog = targets
    .map((t) => `- [${labels[t.type] ?? t.type}] "${t.title}" → ${t.url}`)
    .join("\n");

  const prompt = en
    ? [
        "You are an internal-linking expert for English SEO. Goal: add internal links that give the reader real value - contextual, natural, and precise.",
        "",
        "Existing destinations on the site (pages, product categories/tags in the store, and other posts):",
        catalog,
        "",
        `Post title: ${postTitle}`,
        "Post content:",
        '"""',
        postText,
        '"""',
        "",
        "Rules:",
        "1. Suggest a link only when it is truly relevant and useful to the reader in that paragraph, not just because a word appears.",
        "2. The anchor must be a string that appears **verbatim** in the post body (exact copy, including function words). Prefer a 2-5 word phrase, not a generic single word and not a full sentence.",
        "3. Each anchor once only. Do not suggest a link to the same destination twice.",
        "4. Match each anchor to the most contextual destination: a product type mention → that product category/tag, a topic that has a post → that post, general information → the page.",
        "5. Quality over quantity - up to 8 suggestions, only ones with clear value. If there are no good matches, return an empty array.",
        "6. For each suggestion write a short reason in English that explains the value to the reader.",
        "",
        "Return JSON: { suggestions: [{ anchor, target_url, target_title, target_type, reason }] }. target_url must be one of the URLs in the list.",
      ].join("\n")
    : [
        "אתה מומחה קישורים פנימיים (Internal Linking) ל-SEO בעברית. המטרה: להוסיף לפוסט קישורים פנימיים שיש להם ערך אמיתי לגולש - הקשריים, טבעיים, ומדויקים.",
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
        "1. הצע קישור רק כשהוא באמת רלוונטי ומועיל לגולש בהקשר של הפסקה - לא סתם כי מילה מופיעה.",
        "2. עוגן הקישור (anchor) חייב להיות מחרוזת שמופיעה **מילה-במילה** בתוך תוכן הפוסט (העתק מדויק, כולל אותיות יחס). עדיף ביטוי בן 2-5 מילים, לא מילה בודדת גנרית ולא משפט שלם.",
        "3. כל עוגן פעם אחת בלבד. אל תציע קישור לאותו יעד פעמיים.",
        "4. התאם כל עוגן ליעד ההקשרי ביותר: הזכרת סוג מוצר → קטגוריית/תגית המוצר. נושא שיש עליו פוסט → הפוסט. מידע כללי → העמוד.",
        "5. איכות על פני כמות - עד 8 הצעות, רק כאלה עם ערך ברור. אם אין התאמות טובות, החזר מערך ריק.",
        "6. לכל הצעה כתוב reason קצר בעברית שמסביר את הערך לגולש.",
        "",
        "החזר JSON: { suggestions: [{ anchor, target_url, target_title, target_type, reason }] }. target_url חייב להיות אחד מה-URL-ים ברשימה.",
      ].join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: LINK_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 4096,
      },
    },
    { thinkingLevel: "LOW" }
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];
  try {
    return (JSON.parse(text) as { suggestions: LinkSuggestion[] }).suggestions ?? [];
  } catch {
    return [];
  }
}

export interface CategoryIdea {
  title: string;
  category_id: number;
  brief: Omit<IdeaBrief, "seo_evidence_type">;
}

const CATEGORY_IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          category_id: { type: "number" },
          brief: IDEA_BRIEF_SCHEMA,
        },
        required: ["title", "category_id", "brief"],
      },
    },
  },
  required: ["ideas"],
};

/**
 * Generates detailed idea briefs, each tied to the most relevant product
 * category (spec §1.3), grounded in SEO research (spec §4) and de-duplicated
 * (semantically) against existing articles and all prior ideas.
 */
export async function generateCategoryIdeas(
  env: Env,
  systemPrompt: string,
  categories: { id: number; name: string; sampleProducts: string[] }[],
  research: IdeaResearch,
  count = 6,
  language: ContentLanguage = "he"
): Promise<CategoryIdea[]> {
  const lang = langOf(language);
  const en = lang === "en";
  const catalog = categories
    .map(
      (c) =>
        `- category_id ${c.id} · "${c.name}"${
          c.sampleProducts.length
            ? en
              ? ` (sample products: ${c.sampleProducts.slice(0, 12).join(", ")})`
              : ` (מוצרים לדוגמה: ${c.sampleProducts.slice(0, 12).join(", ")})`
            : ""
        }`
    )
    .join("\n");

  const prompt = [
    systemPrompt?.trim() ||
      (en
        ? "You are an SEO content strategist for an English ecommerce store."
        : "אתה אסטרטג תוכן SEO לחנות מסחר אלקטרוני בעברית."),
    en
      ? "Run a short SEO research based on the data below and produce detailed briefs for new content ideas."
      : "בצע מחקר SEO קצר על סמך הנתונים שלהלן והפק בריפים מפורטים לרעיונות תוכן חדשים.",
    "",
    en
      ? "Available product categories (with sample products from stock):"
      : "קטגוריות המוצרים הזמינות (עם מוצרים לדוגמה מהמלאי):",
    catalog,
    "",
    ...researchBlocks(research, lang),
    "",
    en
      ? `Produce ${count} new, high-quality article ideas. Each idea must be tied to one category_id from the list - the most relevant to the article topic - so the content supports products sold in that category. ${BRIEF_INSTRUCTION.en}`
      : `הפק ${count} רעיונות למאמרים חדשים ואיכותיים. כל רעיון חייב להיות משויך ל-category_id אחד מהרשימה - הרלוונטי ביותר לנושא הכתבה - כדי שהתוכן יתמוך במוצרים הנמכרים בקטגוריה. ${BRIEF_INSTRUCTION.he}`,
    en
      ? "Return JSON: { ideas: [{ title, category_id, brief }] }."
      : "החזר JSON: { ideas: [{ title, category_id, brief }] }.",
  ].join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: CATEGORY_IDEAS_SCHEMA,
        temperature: 0.9,
        maxOutputTokens: 16384,
      },
    },
    { thinkingLevel: "MEDIUM" }
  );

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini לא החזיר רעיונות");
  try {
    return (JSON.parse(text) as { ideas: CategoryIdea[] }).ideas?.slice(0, count) ?? [];
  } catch {
    throw new Error("Gemini החזיר תשובה לא תקינה (ייתכן שהתשובה נחתכה)");
  }
}

/**
 * Picks the most relevant product category for a post title (spec §2.3),
 * from the given eligible categories. Returns the category id, or null.
 */
export async function pickCategoryForTitle(
  env: Env,
  title: string,
  categories: { id: number; name: string }[]
): Promise<number | null> {
  if (!categories.length) return null;
  const prompt = [
    "בחר את קטגוריית המוצרים הרלוונטית ביותר לכותרת המאמר הבאה, מתוך הרשימה.",
    `כותרת המאמר: ${title}`,
    "קטגוריות:",
    categories.map((c) => `- category_id ${c.id} · "${c.name}"`).join("\n"),
    "החזר JSON: { category_id: <number> } — המזהה של הקטגוריה המתאימה ביותר בלבד.",
  ].join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: { category_id: { type: "number" } },
          required: ["category_id"],
        },
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    },
    { thinkingLevel: "LOW" }
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;
  try {
    const id = (JSON.parse(text) as { category_id: number }).category_id;
    return categories.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Bulk-matches existing article titles to product categories in one call
 * (spec §1.2). Returns category ids aligned to the input titles (null = none).
 */
export async function assignCategoriesToTitles(
  env: Env,
  titles: string[],
  categories: { id: number; name: string }[]
): Promise<(number | null)[]> {
  if (!titles.length || !categories.length) return titles.map(() => null);
  const prompt = [
    "שייך כל מאמר לקטגוריית המוצרים הרלוונטית ביותר מתוך הרשימה.",
    "קטגוריות:",
    categories.map((c) => `- category_id ${c.id} · "${c.name}"`).join("\n"),
    "",
    "מאמרים (index · כותרת):",
    titles.map((t, i) => `${i} · ${t}`).join("\n"),
    "",
    "החזר JSON: { assignments: [{ index, category_id }] } — לכל מאמר את category_id המתאים ביותר מהרשימה.",
  ].join("\n");

  const data = await callGeminiText(
    env,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            assignments: {
              type: "array",
              items: {
                type: "object",
                properties: { index: { type: "number" }, category_id: { type: "number" } },
                required: ["index", "category_id"],
              },
            },
          },
          required: ["assignments"],
        },
        temperature: 0.1,
        maxOutputTokens: 4096,
      },
    },
    { thinkingLevel: "LOW" }
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const out: (number | null)[] = titles.map(() => null);
  if (!text) return out;
  try {
    const valid = new Set(categories.map((c) => c.id));
    for (const a of (JSON.parse(text) as { assignments: { index: number; category_id: number }[] })
      .assignments ?? []) {
      if (a.index >= 0 && a.index < out.length && valid.has(a.category_id)) {
        out[a.index] = a.category_id;
      }
    }
  } catch {
    /* keep nulls */
  }
  return out;
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

  // Image models don't use thinkingConfig — call the raw helper directly.
  const data = await callGemini(
    env,
    {
      contents: [{ parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    },
    { model: imageModel(env), retries: 1 }
  );

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
