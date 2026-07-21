# SEO Dashboard — תוכנית פרויקט

**עודכן לאחרונה:** 2026-07-21

---

## 1. מה בונים (בשפה פשוטה)

דאשבורד ניהול אחד לסוכנות קידום אורגני, שמנהל **הפקת תוכן לבלוגים ב-WordPress** עבור מספר לקוחות (אתרים).
לכל לקוח = "פרויקט", ובוחרים ביניהם עם **סוויצ'ר** בראש המסך.

בכל פרויקט אפשר:
1. **ליצור ולערוך פוסטים** של הלקוח (סנכרון דו-כיווני מול אתר ה-WordPress).
2. **לכתוב פוסטים עם Gemini** (טקסט).
3. **ליצור תמונות עם Nano Banana 2** (מודל התמונות של Gemini) — תמונה ראשית + תמונות גוף.
4. **לכתוב שדות Yoast SEO ולדחוף לאתר:** `Focus Keyword`, `SEO Title`, `Meta Description`.
5. **"הצע לי רעיונות חדשים"** — שולח את כל כותרות הפוסטים הקיימים באתר ל-Gemini ומבקש 10 רעיונות חדשים שעוד לא נכתבו. לחיצה על רעיון → כתיבת הפוסט המלא (פרומפט קבוע) + יצירת תמונה (פרומפט תמונה כללי קבוע + הנחיה ספציפית).

### מסך יצירת/עריכת פוסט כולל:
- כותרת
- טקסט מלא — **עורך עשיר מתקדם** (כמו של WordPress)
- תמונה ראשית (Featured Image)
- תמונות נוספות בגוף הפוסט
- שדות Yoast SEO (Focus Keyword / SEO Title / Meta Description)
- בחירת **קטגוריות ותגיות** מתוך הרשימה הקיימת בכל אתר + **יצירת ערכים חדשים** בעת הצורך

---

## 2. Stack מוצע (Cloudflare-first)

> הדומיין מנוהל ב-Cloudflare והמשתמש רוצה להשתמש ב-Workers → כל ה-Hosting על Cloudflare.

| שכבה | טכנולוגיה | נימוק |
|------|-----------|--------|
| Frontend | **React + Vite + TypeScript** (SPA) | דאשבורד אדמין מאחורי אימות — לא נדרש SSR/SEO; SPA מהיר ופשוט על Cloudflare |
| UI | Tailwind CSS + shadcn/ui | מהיר, נקי, נגיש |
| עורך טקסט | **TipTap** (מפיק HTML נקי תואם WordPress) | פתרון ריאלי לעורך "כמו WP" בלי לשכפל את Gutenberg |
| Backend / API | **Cloudflare Workers + Hono** | Workers כפי שביקש המשתמש; Hono = ראוטר קליל ל-API; סודות כ-Worker Secrets |
| DB + Auth + Storage | **Supabase** | קונקטור זמין |
| AI טקסט | **Gemini** | דרישה |
| AI תמונות | **Nano Banana 2** (Gemini Image) | דרישה — דרך אותו Gemini API |
| מייל | **Resend** | קונקטור זמין |
| Hosting + DNS | **Cloudflare** (Workers Assets ל-SPA + Worker ל-API + DNS) | הכל בפלטפורמה אחת, סאב-דומיין `seo.uriyaganor.com` |
| גיבוי קוד | **GitHub** — `github.com/uriyagan/seodashboard` | קומיטים שוטפים |

**חלוקת פריסה:** ה-SPA מוגש כ-Static Assets מה-Worker; אותו Worker (Hono) חושף `/api/*` שמתווך מול Supabase (service-role), Gemini, Resend ו-WordPress. כל הסודות = Worker Secrets.

---

## 3. חיבור ל-WordPress (הלב הטכני)

- **חיבור לכל אתר:** WordPress REST API (`/wp-json/wp/v2/...`) עם **Application Passwords** (מובנה ב-WP).
  לכל פרויקט נשמור: `site_url`, `username`, `application_password` — **מוצפנים** ב-Supabase.
- **פוסטים / קטגוריות / תגיות / מדיה:** קריאה ויצירה דרך ה-REST הסטנדרטי.
- **שדות Yoast (Focus Keyword / Title / Meta Desc):** ⚠️ ברירת המחדל של WP REST **לא** מאפשרת כתיבה ל-meta מוגן של Yoast.
  **הפתרון:** snippet קטן בתצורת **mu-plugin** שנתקין בכל אתר לקוח, שחושף את שלושת שדות ה-Yoast ל-REST לכתיבה
  (`_yoast_wpseo_focuskw`, `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`). אספק את הקוד המוכן.
- **תמונות שנוצרות:** נוצרות ב-Gemini → מועלות ל-**Media Library** של האתר (כדי שיהיה URL אמיתי) → נקבעות כ-Featured / משובצות בגוף. עותק גיבוי יישמר ב-Supabase Storage.

---

## 4. מודל נתונים ראשוני (Supabase)

- `admins` — 2 המשתמשים המורשים (allowlist).
- `projects` — לקוח/אתר: שם, `site_url`, פרטי חיבור מוצפנים, ו-**שני פרומפטים per-לקוח הניתנים לעריכה בכל עת**:
  - `content_prompt` — פרומפט ליצירת התוכן הכתוב.
  - `image_prompt` — פרומפט ליצירת התמונה הראשית של הפוסט.
- `posts` — טיוטות/עותקים מקומיים לפני/אחרי דחיפה: כותרת, תוכן HTML, Yoast fields, קטגוריות/תגיות, סטטוס, `wp_post_id`.
- `post_images` — תמונות שנוצרו (URL ב-WP + גיבוי Supabase, פרומפט).
- `ideas` — רעיונות שנוצרו ב-Gemini לכל פרויקט (כותרת, סטטוס: הוצע/נכתב/נדחה).
- `settings` — הגדרות כלליות.

> הערה: הפרומפטים אינם טבלה גלובלית אלא **שדות על כל פרויקט** (`content_prompt`, `image_prompt`), עם מסך עריכה ייעודי בכל לקוח.
- מדיניות **RLS** תגביל גישה ל-2 האדמינים בלבד.

---

## 5. שלבי ביצוע (Phases)

### Phase 0 — תשתיות והחלטות
- אישור Stack, איסוף credentials.
- חיבור repo ל-GitHub (`github.com/uriyagan/seodashboard`) + גיבוי שוטף.
- אימות פרויקט Supabase (`jyhkgxkrapcrlcfgtekh`).
- הקמת Cloudflare Worker + DNS לסאב-דומיין `seo.uriyaganor.com`.

### Phase 1 — Auth ושלד
- אפליקציית React+Vite, Supabase Auth עם allowlist ל-2 אדמינים, נתיבים מוגנים.
- **מסך התחברות** עם: אימייל+סיסמה, "זכור אותי" (persistent session), "שכחתי סיסמה" (reset דרך Supabase).
- שני משתמשי אדמין: `sam@uriyaganor.com`, `info@uriyaganor.com` (סיסמה נקבעת ע"י המשתמשים דרך invite/reset — לא נשמרת בקוד).
- טבלת `projects` + **סוויצ'ר פרויקטים** + Layout בסיסי.
- מסך עריכת שני הפרומפטים per-לקוח.

### Phase 2 — אינטגרציית WordPress
- שמירת חיבור WP מוצפן, WP REST client (פוסטים/קטגוריות/תגיות/מדיה).
- mu-plugin ל-Yoast (קריאה/כתיבה).
- יצירה/עריכה/פרסום פוסטים + סנכרון רשימת פוסטים קיימים.

### Phase 3 — מסך העורך
- כותרת, עורך TipTap, Featured image, תמונות גוף, שדות Yoast, קטגוריות/תגיות (בחירה + יצירה חדשה).
- דחיפה ל-WP (טיוטה/פרסום).

### Phase 4 — Gemini: טקסט
- יצירת פוסט מפרומפט קבוע + נושא. שילוב בעורך.

### Phase 5 — Nano Banana 2: תמונות
- יצירת תמונה ראשית + תמונות גוף. העלאה ל-Media של WP + גיבוי Supabase.

### Phase 6 — מנוע רעיונות
- "הצע לי רעיונות" — משיכת כל הכותרות → Gemini → 10 רעיונות.
- לחיצה על רעיון → כתיבת פוסט מלא + תמונה (פרומפטים קבועים) → נחת בעורך לאישור.

### Phase 7 — התראות (Resend)
- מייל לאדמינים על אירועים נבחרים (למשל: פוסט פורסם / רעיונות מוכנים / שגיאה).

### Phase 8 — ליטוש, פריסה, תיעוד סופי
- QA, אבטחה (הצפנת מפתחות, RLS), פריסה לפרודקשן, עדכון מסמכים.

---

## 6. סוגיות פתוחות / החלטות שממתינות למשתמש
- אישור Stack ו-Hosting.
- רמת נאמנות העורך (HTML נקי מול Gutenberg מלא).
- Workflow פרסום (טיוטה / פרסום ישיר / לבחירה per-post).
- אילו אירועים מזמנים התראת מייל.
- רשימת אתרי הלקוחות + הרשאה להתקין mu-plugin.
- הפרומפטים הקבועים (כתיבה + תמונה) — לספק או שאנסח גרסה ראשונה.
