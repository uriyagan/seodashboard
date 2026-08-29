/** Language of generated ideas, articles, and SEO metadata. Dashboard UI stays Hebrew. */
export type ContentLanguage = "he" | "en";

export function parseContentLanguage(value: unknown): ContentLanguage {
  return value === "en" ? "en" : "he";
}

export function featuredImagePrompt(title: string, lang: ContentLanguage): string {
  return lang === "en"
    ? `Featured image for the post: ${title}`
    : `תמונה ראשית לפוסט: ${title}`;
}
