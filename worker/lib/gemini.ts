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

const JOURNEY_LABEL: Record<string, string> = {
  discovery: "גילוי",
  comparison: "השוואה",
  decision: "החלטה",
  "post-purchase": "לאחר רכישה",
};

/** Real search data + content inventory assembled before idea generation (spec §4). */
export interface IdeaResearch {
  /** Search Console query rows — undefined when no GSC data is available. */
  gscQueries?: { query: string; clicks: number; impressions: number; position: number }[];
  existingPosts: { title: string; focus_keyword?: string | null }[];
  /** Titles of ALL ideas ever suggested (any status) — for dedup. */
  allIdeaTitles: string[];
}

export interface ArticleContext {
  categoryName?: string;
  productNames?: string[];
  brief?: IdeaBrief;
}

/**
 * Generates a full blog article as structured JSON.
 * `systemPrompt` is the project's editable content_prompt. When `context`
 * carries a product category + products, the article is written around them
 * so it stays relevant to the store's catalog (spec §2.4) instead of generic.
 */
export async function generateArticle(
  env: Env,
  systemPrompt: string,
  topic: string,
  keywords: string[] = [],
  context: ArticleContext = {}
): Promise<GeneratedArticle> {
  const keywordLine =
    keywords.length > 0
      ? `מילות המפתח (ביטויי חיפוש) של העסק: ${keywords.join(", ")}. בחר את המתאימה ביותר לנושא הפוסט כ-focus_keyword (או נסח מתאימה אם אף אחת אינה מדויקת), ובנה את הפוסט סביבה.`
      : "";
  const categoryBlock = context.categoryName
    ? [
        "",
        "המאמר נכתב עבור אתר מסחר אלקטרוני (חנות).",
        `קטגוריית המוצרים שאליה המאמר משויך: ${context.categoryName}`,
        context.productNames && context.productNames.length
          ? `מוצרים מובילים ורלוונטיים בקטגוריה (התייחס אליהם באופן טבעי בתוכן, בלי לפרסם באגרסיביות): ${context.productNames.join(", ")}`
          : "",
        "יש להביא בחשבון את הקטגוריה ואת המוצרים כדי שהתוכן יהיה רלוונטי למוצרים הנמכרים באתר ולא גנרי.",
      ].filter(Boolean)
    : [];
  const b = context.brief;
  const briefBlock = b
    ? [
        "",
        "בריף תוכן (Content Brief) — כתוב את המאמר לפי ההכוונה הזו:",
        `תקציר: ${b.summary}`,
        `זווית מרכזית: ${b.angle}`,
        b.main_topics.length ? `נושאים מרכזיים לכיסוי: ${b.main_topics.join(" | ")}` : "",
        b.deep_dive_points.length ? `נקודות להעמקה: ${b.deep_dive_points.join(" | ")}` : "",
        `קהל יעד: ${b.target_audience}`,
        `כוונת חיפוש: ${b.search_intent}`,
        `ערך מעשי לקורא: ${b.reader_value}`,
        `מילת מפתח ראשית: ${b.primary_keyword} — השתמש בה כ-focus_keyword ושלב אותה באופן טבעי בכותרת, בפתיח ובכותרות המשנה.`,
        b.secondary_keywords.length
          ? `מילות מפתח משניות ושאלות לשילוב טבעי: ${b.secondary_keywords.join(", ")}`
          : "",
        `שלב במסע הלקוח: ${JOURNEY_LABEL[b.journey_stage] ?? b.journey_stage}`,
        "עקוב אחרי הכיוון של הבריף — הנושאים, הזווית, הכוונה והמילים — אבל כתוב מאמר זורם וטבעי. אל תעתיק את ניסוחי הבריף מילה במילה ואל תהפוך אותו לרשימת סעיפים מכנית.",
      ].filter(Boolean)
    : [];
  const prompt = [
    systemPrompt?.trim() || "כתוב מאמר בלוג איכותי, מקצועי ומותאם SEO בעברית.",
    ...categoryBlock,
    ...briefBlock,
    "",
    `נושא הפוסט: ${topic}`,
    // When a brief exists its primary_keyword takes precedence over the generic list.
    b ? "" : keywordLine,
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

/**
 * Renders the shared SEO-research prompt blocks (spec §4): real Search Console
 * queries when available (else an explicit qualitative-only instruction that
 * forbids inventing numbers), the existing-content inventory, and the full
 * dedup list with a semantic-overlap rule.
 */
function researchBlocks(research: IdeaResearch): string[] {
  const gsc = research.gscQueries;
  const seoBlock = gsc && gsc.length
    ? [
        "נתוני חיפוש אמיתיים מ-Google Search Console (90 הימים האחרונים) — התבסס עליהם:",
        gsc
          .map(
            (r) =>
              `- "${r.query}" · ${r.clicks} קליקים · ${r.impressions} הופעות · מיקום ממוצע ${r.position.toFixed(1)}`
          )
          .join("\n"),
        "בסס את מילות המפתח הראשיות והמשניות על שאילתות אמיתיות מהרשימה כשרלוונטי. שאילתות עם הרבה הופעות ומיקום ממוצע גבוה מ-10 הן הזדמנויות תוכן חזקות.",
      ]
    : [
        "אין נתוני חיפוש חיצוניים זמינים. בצע הערכה איכותנית בלבד של פוטנציאל החיפוש על בסיס כוונות חיפוש סבירות, שאלות נפוצות ושלבי קבלת החלטה.",
        "**אסור להמציא נפחי חיפוש, מספרים או נתונים כמותיים.** נמק במילים בלבד.",
      ];
  return [
    ...seoBlock,
    "",
    "מאמרים שכבר קיימים באתר (כותרת · מילת מפתח ראשית):",
    research.existingPosts
      .map((p) => `- ${p.title}${p.focus_keyword ? ` · ${p.focus_keyword}` : ""}`)
      .join("\n") || "(אין)",
    "",
    "כל הרעיונות שהוצעו אי-פעם (כולל שנכתבו ושנדחו) — אין להציע אותם שוב:",
    research.allIdeaTitles.map((t) => `- ${t}`).join("\n") || "(אין)",
    "",
    "מנע קניבליזציה: אל תציע רעיון שחופף סמנטית לכותרת קיימת או לרעיון קודם — גם אם הניסוח שונה. חפיפה סמנטית = אותו נושא ליבה ואותה כוונת חיפוש. אם נושא דומה כבר קיים, דלג עליו או הצע זווית שונה מהותית (קהל אחר, שלב אחר במסע הלקוח, או פורמט אחר) וציין זאת במפורש בשדה angle.",
  ];
}

/** The Hebrew instruction describing the full brief each idea must include. */
const BRIEF_INSTRUCTION =
  "לכל רעיון החזר בריף מלא: summary (תקציר של 2–4 משפטים), angle (הזווית המרכזית), main_topics (3–5 נושאים מרכזיים), deep_dive_points (נקודות שכדאי להעמיק בהן), target_audience (קהל היעד), search_intent (כוונת החיפוש), reader_value (הערך המעשי לקורא), category_fit (מדוע הרעיון מתאים), primary_keyword (מילת מפתח ראשית), secondary_keywords (3–8 מילות מפתח או שאלות משניות), journey_stage (אחד מ: discovery / comparison / decision / post-purchase). כל הטקסט בעברית מלבד journey_stage.";

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
  count = 6
): Promise<{ title: string; brief: Omit<IdeaBrief, "seo_evidence_type"> }[]> {
  const prompt = [
    systemPrompt?.trim() || "אתה אסטרטג תוכן SEO לאתר תדמית בעברית.",
    "בצע מחקר SEO קצר על סמך הנתונים שלהלן והפק בריפים מפורטים לרעיונות תוכן חדשים.",
    "",
    ...researchBlocks(research),
    "",
    `הפק ${count} רעיונות לפוסטים חדשים ואיכותיים הרלוונטיים לתחום האתר. ${BRIEF_INSTRUCTION}`,
    "בשדה category_fit הסבר את ההתאמה לתחום האתר. החזר JSON: { ideas: [{ title, brief }] }.",
  ].join("\n");

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: BROCHURE_IDEAS_SCHEMA,
      temperature: 0.9,
      maxOutputTokens: 16384,
    },
  });

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
  count = 6
): Promise<CategoryIdea[]> {
  const catalog = categories
    .map(
      (c) =>
        `- category_id ${c.id} · "${c.name}"${
          c.sampleProducts.length ? ` (מוצרים לדוגמה: ${c.sampleProducts.slice(0, 12).join(", ")})` : ""
        }`
    )
    .join("\n");

  const prompt = [
    systemPrompt?.trim() || "אתה אסטרטג תוכן SEO לחנות מסחר אלקטרוני בעברית.",
    "בצע מחקר SEO קצר על סמך הנתונים שלהלן והפק בריפים מפורטים לרעיונות תוכן חדשים.",
    "",
    "קטגוריות המוצרים הזמינות (עם מוצרים לדוגמה מהמלאי):",
    catalog,
    "",
    ...researchBlocks(research),
    "",
    `הפק ${count} רעיונות למאמרים חדשים ואיכותיים. כל רעיון חייב להיות משויך ל-category_id אחד מהרשימה — הרלוונטי ביותר לנושא הכתבה — כדי שהתוכן יתמוך במוצרים הנמכרים בקטגוריה. ${BRIEF_INSTRUCTION}`,
    "החזר JSON: { ideas: [{ title, category_id, brief }] }.",
  ].join("\n");

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: CATEGORY_IDEAS_SCHEMA,
      temperature: 0.9,
      maxOutputTokens: 16384,
    },
  });

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

  const data = await callGemini(env, textModel(env), {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: { category_id: { type: "number" } },
        required: ["category_id"],
      },
      temperature: 0.1,
    },
  });
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

  const data = await callGemini(env, textModel(env), {
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
    },
  });
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
