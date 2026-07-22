/**
 * Live Yoast SEO + readability analysis, using Yoast's own `yoastseo` engine
 * with the Hebrew researcher. Heavy — dynamically imported on first use.
 */

export type Rating = "good" | "ok" | "bad";

export interface Check {
  id: string;
  rating: Rating;
  label: string;
  tip: string;
}

export interface Analysis {
  seo: { score: number; rating: Rating; checks: Check[] };
  readability: { score: number; rating: Rating; checks: Check[] };
}

export interface AnalysisInput {
  content: string;
  keyword: string;
  title: string;
  description: string;
  slug: string;
  /** Full site URL (with hostname) — required so links to the same domain
   *  are detected as internal (Yoast classifies links by permalink host). */
  siteUrl: string;
  /** SEO-title width in pixels (Yoast's title check uses px, not chars).
   *  Measured on the main thread via measureTitleWidth; 0 in the worker. */
  titleWidth: number;
}

/**
 * Pixel width of the SEO title, matching Yoast's own measurement element
 * (arial 20px / weight 400). Runs on the main thread only (needs a canvas);
 * returns 0 where no DOM is available (e.g. inside the worker).
 */
let _measureCtx: CanvasRenderingContext2D | null = null;
export function measureTitleWidth(title: string): number {
  if (typeof document === "undefined") return 0;
  if (!_measureCtx) {
    _measureCtx = document.createElement("canvas").getContext("2d");
    if (_measureCtx) _measureCtx.font = "400 20px arial";
  }
  if (!_measureCtx) return 0;
  return Math.round(_measureCtx.measureText(title || "").width);
}

// Hebrew labels for each assessment identifier (fallback: the raw English text).
const LABELS: Record<string, string> = {
  // SEO
  introductionKeyword: "מילת מפתח בפסקה הפותחת",
  keyphraseLength: "אורך מילת המפתח",
  keyphraseDensity: "צפיפות מילת המפתח",
  metaDescriptionKeyword: "מילת מפתח בתיאור המטא",
  metaDescriptionLength: "אורך תיאור המטא",
  subheadingsKeyword: "מילת מפתח בכותרות משנה",
  textCompetingLinks: "לינקים מתחרים",
  imageKeyphrase: "מילת מפתח ב-alt של תמונות",
  images: "תמונות בתוכן",
  textLength: "אורך התוכן",
  externalLinks: "לינקים חיצוניים",
  keyphraseInSEOTitle: "מילת מפתח בכותרת ה-SEO",
  internalLinks: "לינקים פנימיים",
  titleWidth: "אורך כותרת ה-SEO",
  slugKeyword: "מילת מפתח בכתובת (Slug)",
  functionWordsInKeyphrase: "מילות פונקציה במילת המפתח",
  singleH1: "כותרת H1 יחידה",
  // Readability
  subheadingsTooLong: "פיזור כותרות משנה",
  textParagraphTooLong: "אורך פסקאות",
  textSentenceLength: "אורך משפטים",
  textTransitionWords: "מילות מעבר",
  passiveVoice: "שימוש בקול סביל",
  sentenceBeginnings: "פתיחות משפטים חוזרות",
  textPresence: "קיים תוכן לניתוח",
  wordComplexity: "מורכבות מילים",
  listPresence: "שימוש ברשימות",
};

// Actionable "what to do" guidance in Hebrew, per assessment (shown when a
// check needs improvement).
const TIPS: Record<string, string> = {
  // SEO
  introductionKeyword: "כלול את מילת המפתח בפסקה הראשונה של הפוסט.",
  keyphraseLength: "כוון למילת מפתח באורך של 1–4 מילות תוכן.",
  keyphraseDensity: "אם היא חוזרת יותר מדי — הפחת חזרות; אם פחות מדי — הוסף. יעד: כ-0.5%–3%.",
  metaDescriptionKeyword: "שלב את מילת המפתח בתיאור המטא.",
  metaDescriptionLength: "אורך אידיאלי 120–156 תווים. קצר אם ארוך, הארך אם קצר.",
  subheadingsKeyword: "כלול את מילת המפתח באחת מכותרות המשנה (H2/H3).",
  textCompetingLinks: "יש קישורים עם עוגן זהה למילת המפתח שמתחרים בפוסט — שנה אותם.",
  imageKeyphrase: "הוסף מילת מפתח לטקסט ה-alt של לפחות תמונה אחת.",
  images: "הוסף לפחות תמונה אחת לגוף הפוסט.",
  textLength: "הארך את הפוסט — לפחות 300 מילים, מומלץ 900+.",
  externalLinks: "הוסף לפחות קישור חיצוני אחד למקור רלוונטי.",
  keyphraseInSEOTitle: "כלול את מילת המפתח בכותרת ה-SEO, רצוי בתחילתה.",
  internalLinks: "הוסף לפחות קישור פנימי אחד לעמוד או פוסט אחר באתר.",
  titleWidth: "אורך אידיאלי 50–60 תווים. קצר אם ארוכה מדי, הארך אם קצרה — כדי שלא תיחתך בגוגל.",
  slugKeyword: "כלול את מילת המפתח בכתובת ה-URL (Slug).",
  functionWordsInKeyphrase: "הוסף למילת המפתח מילים משמעותיות (לא רק מילות קישור).",
  singleH1: "ודא שיש כותרת H1 אחת בלבד (הכותרת הראשית).",
  // Readability
  subheadingsTooLong: "יש קטע ארוך ללא כותרת משנה — הוסף כותרת שתפרק אותו.",
  textParagraphTooLong: "יש פסקאות ארוכות מדי — פצל אותן לפסקאות קצרות יותר.",
  textSentenceLength: "יש יותר מדי משפטים ארוכים — קצר או פצל משפטים מעל 20 מילים.",
  textTransitionWords: "הוסף מילות מעבר (לכן, בנוסף, לעומת זאת) לשיפור הזרימה.",
  passiveVoice: "יש שימוש רב בקול סביל — נסח משפטים בקול פעיל.",
  sentenceBeginnings: "כמה משפטים רצופים מתחילים באותה מילה — גוון את הפתיחות.",
  textPresence: "אין מספיק טקסט לניתוח — הוסף תוכן.",
  wordComplexity: "יש הרבה מילים מורכבות — פשט את השפה.",
  listPresence: "שקול להוסיף רשימה (בּוליטים/מספור) לשיפור הקריאוּת.",
};

interface YoastResult {
  _identifier: string;
  score: number;
  text: string;
}
interface YoastAssessor {
  assess: (paper: unknown) => void;
  getValidResults: () => YoastResult[];
  calculateOverallScore: () => number;
}
interface YoastEngine {
  Paper: new (text: string, attrs: Record<string, unknown>) => unknown;
  SeoAssessor: new (r: unknown) => YoastAssessor;
  ContentAssessor: new (r: unknown) => YoastAssessor;
  interpreters: { scoreToRating: (s: number) => string };
  Researcher: new (p: unknown) => unknown;
}

let loaded: YoastEngine | null = null;

async function load(): Promise<YoastEngine> {
  if (loaded) return loaded;
  const y = await import("yoastseo");
  const researcherMod = await import(
    "yoastseo/build/languageProcessing/languages/he/Researcher"
  );
  loaded = {
    Paper: y.Paper,
    SeoAssessor: y.SeoAssessor,
    ContentAssessor: y.ContentAssessor,
    interpreters: y.interpreters,
    Researcher: researcherMod.default,
  };
  return loaded;
}

function toRating(scoreToRating: (s: number) => string, score: number): Rating {
  const r = scoreToRating(score);
  if (r === "good") return "good";
  if (r === "ok" || r === "feedback") return "ok";
  return "bad";
}

function strip(html: string): string {
  return (html || "").replace(/<[^>]+>/g, "").trim();
}

export async function analyzeYoast(input: AnalysisInput): Promise<Analysis> {
  const { Paper, SeoAssessor, ContentAssessor, interpreters, Researcher } = await load();
  const { scoreToRating } = interpreters;

  const paper = new Paper(input.content || "", {
    keyword: input.keyword || "",
    title: input.title || "",
    titleWidth: input.titleWidth || 0,
    description: input.description || "",
    slug: input.slug || "",
    // Full URL (with hostname) so same-domain links count as internal.
    permalink: input.siteUrl || "",
    locale: "he_IL",
  });
  const researcher = new Researcher(paper);

  const mapResults = (results: YoastResult[]): Check[] =>
    results.map((r) => ({
      id: r._identifier,
      rating: toRating(scoreToRating, r.score),
      label: LABELS[r._identifier] ?? strip(r.text) ?? r._identifier,
      // Hebrew guidance; fall back to Yoast's own (English) feedback text.
      tip: TIPS[r._identifier] ?? strip(r.text),
    }));

  const seoA = new SeoAssessor(researcher);
  seoA.assess(paper);
  const seoScore = seoA.calculateOverallScore();

  const readA = new ContentAssessor(researcher);
  readA.assess(paper);
  const readScore = readA.calculateOverallScore();

  return {
    seo: {
      score: seoScore,
      rating: toRating(scoreToRating, seoScore / 10),
      checks: mapResults(seoA.getValidResults()),
    },
    readability: {
      score: readScore,
      rating: toRating(scoreToRating, readScore / 10),
      checks: mapResults(readA.getValidResults()),
    },
  };
}
