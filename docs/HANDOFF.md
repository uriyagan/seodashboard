# SEO Dashboard — מסמך Handoff

> מסמך זה מתעד את כל ההתקדמות בפרויקט, החלטות שהתקבלו, ומצב נוכחי.
> מתעדכן באופן שוטף לאורך העבודה.

**עודכן לאחרונה:** 2026-07-22

> עדכון אחרון: (1) עוצב מחדש רכיב הקישורים הפנימיים למנוע המלצות מבוסס-תוכן (סורק את הפוסט ומציע לקשר ביטוי ספציפי ליעד קיים — עמוד/קטגוריית מוצר/תגית מוצר/פוסט). (2) נבנה חיבור Google Search Console (OAuth) — כפתור חיבור בהגדרות, בחירת נכס לפרויקט, ושליפת מילות מפתח מדורגות עם הוספה בלחיצה. פרוס לפרודקשן.

---

## סקירה כללית

דאשבורד ניהול לסוכנות קידום אורגני, שיחיה בסאב-דומיין `seo.uriyaganor.com`.

**מטרת הפרויקט:** ניהול הפקת תוכן לבלוגים ב-WordPress עבור מספר לקוחות (אתרים). כלי אחד שבו, לפי פרויקט (סוויצ'ר), אפשר ליצור/לערוך פוסטים, לכתוב תוכן עם Gemini, ליצור תמונות עם Nano Banana 2, לנהל שדות Yoast SEO ולדחוף לאתר, ולהפעיל מנוע רעיונות לפוסטים חדשים.

**תוכנית מלאה:** ראה [PLAN.md](PLAN.md).

### פיצ'רים מרכזיים
1. יצירה ועריכה של פוסטים לכל לקוח (סנכרון מול WordPress).
2. כתיבת פוסטים עם Gemini.
3. יצירת תמונות עם Nano Banana 2.
4. שדות Yoast SEO + דחיפה לאתר (Focus Keyword / SEO Title / Meta Description).
5. "הצע לי רעיונות חדשים" → 10 רעיונות מ-Gemini → כתיבה אוטומטית של פוסט + תמונה.
6. עורך פוסט מלא: כותרת, תוכן עשיר, תמונה ראשית, תמונות גוף, Yoast, קטגוריות/תגיות (בחירה + יצירה).

---

## החלטות ליבה שהתקבלו

| נושא | החלטה | סטטוס |
|------|--------|--------|
| דומיין | `seo.uriyaganor.com` (סאב-דומיין) | ✅ סוכם |
| גישה | אדמינים בלבד — 2 משתמשים | ✅ סוכם |
| שפה ועיצוב | עברית מלאה · RTL · SaaS מודרני ונקי | ✅ סוכם |
| עורך תוכן | TinyMCE — כמו Classic Editor של WP | ✅ סוכם |
| פרסום | תמיד טיוטה (Draft) | ✅ סוכם |
| תזמון וניטור | Cloudflare Cron + התראות קצב | ✅ סוכם |
| אחסון / Database | Supabase (קונקטור מחובר) | ✅ סוכם |
| מנוע AI | Google Gemini | ✅ סוכם |
| AI תמונות | Nano Banana 2 (Gemini Image) | ✅ סוכם |
| התראות מייל | Resend (קונקטור מחובר) | ✅ סוכם |
| ייעוד / פיצ'רים | הפקת תוכן WordPress מרובה-לקוחות | ✅ סוכם |
| חיבור ל-WordPress | REST API + Application Passwords + mu-plugin ל-Yoast | 🔶 מוצע |
| Stack (Frontend) | React + Vite + TypeScript + Tailwind + TipTap | 🔶 מוצע |
| Stack (Backend/API) | Cloudflare Workers + Hono | 🔶 מוצע |
| פלטפורמת הרצה / Hosting | Cloudflare (Workers + DNS) | ✅ סוכם |
| גיבוי קוד | GitHub — uriyagan/seodashboard | ✅ סוכם |

---

## מצב נוכחי

- [x] הגדרת מסגרת עבודה ותיעוד
- [x] יצירת שלד מסמכי תיעוד (Handoff / Architecture / Connections / Plan)
- [x] קבלת פירוט על ייעוד הפרויקט + החלטות מלאות
- [x] בחירת Stack טכנולוגי (React+Vite + Cloudflare Workers/Hono)
- [x] **Phase 0** — git + גיבוי GitHub, פרטי Supabase
- [x] **Phase 1** — שלד אפליקציה, Auth, סכמת Supabase + RLS, סוויצ'ר פרויקטים
- [ ] יצירת/הזמנת 2 משתמשי האדמין ב-Supabase (פעולת משתמש)
- [x] **Phase 2** — אינטגרציית WordPress + אשף הוספת אתר + סנכרון *(נבנה)*
- [x] **Phase 3** — מסך העורך (TinyMCE) + Yoast + קטגוריות/תגיות *(נבנה)*
- [x] **Phase 4–5** — Gemini (טקסט) + Nano Banana 2 (תמונות) *(נבנה)*
- [x] **Phase 6** — מנוע רעיונות *(נבנה)*
- [x] **Phase 7** — תזמון, ניטור והתראות (Cron + Resend) *(נבנה)*
- [x] **Phase 8** — הכנה לפריסה (mu-plugin, DEPLOY.md, wrangler + cron) *(נבנה)*
- [x] **Resend מוגדר** — דומיין `service.uriyaganor.com`, מפתח שליחה, נמענים.
- [x] **Gemini מאומת** — מפתח עובד; מודלים: טקסט `gemini-3.1-pro-preview`, תמונות `gemini-3.1-flash-image`.
- [x] **פריסה ל-Cloudflare** — Worker חי בחשבון info@, כל ה-Secrets מוגדרים, Cron רשום.
- [x] **`seo.uriyaganor.com` חי** — Custom Domain מחובר, SSL פעיל, מגיש את האפליקציה (200 בכל הנתיבים).
- [ ] **`SUPABASE_SERVICE_ROLE_KEY`** — נדרש לניטור ה-Cron (המשתמש יספק מ-Supabase → Settings → API).
- [ ] **בדיקות מקצה-לקצה** — מול אתר WordPress אמיתי (drywall.co.il מוכן: REST+Yoast זוהו).

### מה נבנה ב-Phases 2–8
- **WordPress:** קליינט REST מלא (קריאה/כתיבה), הצפנת AES-GCM, אשף הוספת אתר 3 צעדים + סנכרון, mu-plugin ל-Yoast.
- **עורך:** TinyMCE (כמו Classic Editor), שדות Yoast, בורר קטגוריות/תגיות עם יצירה, תמונה ראשית, שמירת טיוטה + דחיפה ל-WP.
- **AI:** Gemini (`gemini-3-pro`) לכתיבת מאמרים ורעיונות; Nano Banana 2 (`gemini-3.1-flash-image`) לתמונות + העלאה למדיה של WP.
- **מנוע רעיונות:** "הצע רעיונות" → 10 כותרות → "כתוב פוסט" (מאמר+תמונה) → נחיתה בעורך.
- **תזמון:** Cloudflare Cron יומי, ניטור קצב + טיוטות תקועות, התראות מייל (Resend).
- **הגדרות:** עריכת 2 הפרומפטים per-לקוח, קצב, סנכרון, מחיקה.

### מה נבנה ב-Phase 1
- אפליקציית React 19 + Vite 7 + TS + Tailwind v4 (RTL, עברית, גופן Assistant).
- Cloudflare Worker (Hono) עם `/api/health`; SPA מוגש כ-assets.
- Supabase: סכמה מלאה (`admins`, `projects`, `posts`, `post_images`, `ideas`, `wp_terms`, `settings`) + RLS לאדמינים בלבד + `is_admin()`.
- מסכי Auth: התחברות ("זכור אותי"), שכחתי סיסמה, קביעת סיסמה. נתיבים מוגנים.
- שלד דאשבורד: סיידבר, טופ-בר, סוויצ'ר פרויקטים, דיאלוג הוספת אתר (בסיסי), Light/Dark, empty state, סקירת פרויקט.
- הבנייה עוברת (`npm run build`) ומסך ההתחברות נבדק בדפדפן.

---

## שלבים הבאים (בדיקות ופריסה)

1. **פעולת משתמש:** יצירת/הזמנת 2 האדמינים ב-Supabase (Dashboard → Authentication → Users).
2. **מפתחות:** Gemini API key + Resend (דומיין מאומת) → הגדרה ב-`.env.local` (dev) / Worker Secrets (prod).
3. **אתר בדיקה:** WordPress אחד + Application Password + התקנת ה-mu-plugin → בדיקת סנכרון, עריכה, דחיפה, AI, רעיונות.
4. **פריסה:** לפי [DEPLOY.md](DEPLOY.md) — Cloudflare Worker + סאב-דומיין + Cron + הגדרות Supabase Auth.

---

## לוג שינויים

| תאריך | שינוי |
|-------|--------|
| 2026-07-21 | פתיחת הפרויקט. תיעוד החלטות ליבה. יצירת שלד מסמכי התיעוד. |
| 2026-07-21 | קבלת פירוט מלא על ייעוד הפרויקט (הפקת תוכן WordPress). כתיבת [PLAN.md](PLAN.md). עדכון ארכיטקטורה וחיבורים. |
| 2026-07-21 | מעבר ל-Cloudflare (Workers + DNS) במקום Vercel. חיבור פרטי Supabase. הקמת git + גיבוי ל-GitHub. יצירת README, .gitignore, .env. |
| 2026-07-21 | הגדרת דרישות: 2 פרומפטים per-לקוח (content/image), מסך התחברות (זכור אותי / שכחתי סיסמה). 2 אדמינים: info@ + sam@uriyaganor.com. סיסמה תיקבע ע"י המשתמשים (invite/reset). |
| 2026-07-21 | דרישה: אשף "הוספת אתר חדש" מהממשק — 3 צעדים, בדיקת חיבור, סנכרון מיידי של כל הפוסטים/טקסונומיות (סעיף 3b ב-PLAN). |
| 2026-07-21 | החלטת עיצוב: ממשק עברית מלאה, RTL, סגנון SaaS מודרני ונקי (סעיף 2b ב-PLAN). |
| 2026-07-21 | החלטות: עורך = TinyMCE (Classic Editor, לא Gutenberg); פרסום = תמיד טיוטה. פיצ'ר חדש: תזמון וניטור קצב פרסום עם Cloudflare Cron + התראות ("לא הועלה פוסט השבוע" / "נוצר אך לא פורסם") — סעיף 3c ב-PLAN. |
| 2026-07-21 | **Phase 0+1 הושלמו:** סכמת Supabase + RLS (7 טבלאות, `is_admin()`, זריעת 2 אדמינים), שלד React+Vite+Cloudflare Worker, מסכי Auth (התחברות/שכחתי/איפוס), סוויצ'ר פרויקטים ודאשבורד. הבנייה עוברת, מסך התחברות נבדק. נדחף לגיט. |
| 2026-07-21 | **Phase 2 נבנה:** קליינט WordPress REST ב-Worker, הצפנת AES-GCM ל-Application Password, אשף הוספת אתר בן 3 צעדים (check-url / test-connection / connect+sync), סנכרון פוסטים+קטגוריות+תגיות, זיהוי Yoast, מסך רשימת פוסטים + סנכרון מחדש. API נבדק (health + gate 401). |
| 2026-07-21 | **Phases 3–8 נבנו:** עורך TinyMCE + Yoast + קטגוריות/תגיות + תמונה ראשית + דחיפה כטיוטה; אינטגרציית Gemini (טקסט) ו-Nano Banana 2 (תמונות) + העלאה למדיה; מנוע רעיונות (10 רעיונות → כתיבה אוטומטית); Cloudflare Cron יומי לניטור קצב + טיוטות תקועות + התראות Resend; מסך הגדרות (פרומפטים/קצב/סנכרון/מחיקה); mu-plugin ל-Yoast; DEPLOY.md. הבנייה עוברת, bundle מפוצל (TinyMCE lazy). ממתין למפתחות ולבדיקות מקצה-לקצה. |
