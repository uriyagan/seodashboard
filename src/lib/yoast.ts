/**
 * Live Yoast SEO + readability analysis, using Yoast's own `yoastseo` engine
 * with the Hebrew researcher. Heavy — dynamically imported on first use.
 */

export type Rating = "good" | "ok" | "bad";

export interface Check {
  id: string;
  rating: Rating;
  label: string;
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
  subheadingsTooLongText: "פיזור כותרות משנה",
  textParagraphTooLong: "אורך פסקאות",
  textSentenceLength: "אורך משפטים",
  textTransitionWords: "מילות מעבר",
  passiveVoice: "שימוש בקול סביל",
  sentenceBeginnings: "פתיחות משפטים חוזרות",
  textPresence: "קיים תוכן לניתוח",
  wordComplexity: "מורכבות מילים",
  listPresence: "שימוש ברשימות",
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
    description: input.description || "",
    slug: input.slug || "",
    permalink: input.slug || "",
    locale: "he_IL",
  });
  const researcher = new Researcher(paper);

  const mapResults = (results: YoastResult[]): Check[] =>
    results.map((r) => ({
      id: r._identifier,
      rating: toRating(scoreToRating, r.score),
      label: LABELS[r._identifier] ?? strip(r.text) ?? r._identifier,
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
