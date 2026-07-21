# SEO Dashboard — חיבורים ו-API

> מסמך זה מתעד את כל השירותים החיצוניים, הקונקטורים, ה-API keys ומשתני הסביבה.
> **אין לשמור סודות/מפתחות בפועל במסמך זה** — רק שמות המשתנים ותיאור. הסודות נשמרים ב-env / Supabase secrets.

**עודכן לאחרונה:** 2026-07-21

---

## שירותים חיצוניים

### 1. Supabase
- **תפקיד:** DB (Postgres) + Auth + Storage.
- **קונקטור:** מחובר (Supabase MCP).
- **Project URL:** `https://jyhkgxkrapcrlcfgtekh.supabase.co`
- **Project Ref:** `jyhkgxkrapcrlcfgtekh`
- **Publishable key (client-safe):** נשמר ב-`.env.local` כ-`VITE_SUPABASE_PUBLISHABLE_KEY` (מתחיל ב-`sb_publishable_...`).
- **משתני סביבה נדרשים:**
  - `VITE_SUPABASE_URL` (client)
  - `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable — client)
  - `SUPABASE_SERVICE_ROLE_KEY` (server-side בלבד — Worker Secret, לא לחשוף!)

### 2. Google Gemini (טקסט + תמונות / Nano Banana 2)
- **תפקיד:** מנוע AI לכתיבת פוסטים ורעיונות (טקסט) + יצירת תמונות (Nano Banana 2 — מודל התמונות של Gemini).
- **API:** Google Generative AI API (Gemini).
- **משתני סביבה נדרשים:**
  - `GEMINI_API_KEY` (server-side בלבד)
- **מודלים:**
  - טקסט: `gemini-*` (ייקבע בעת ההקמה — הדור העדכני).
  - תמונות: Nano Banana 2 (מזהה מודל מדויק יאומת בעת ההקמה).
- **דורש:** חשבון Google AI Studio / Google Cloud עם חיוב מופעל למודל התמונות.
- **סטטוס:** ⏳ ממתין למפתח API.

### 2b. WordPress — אתרי לקוחות
- **תפקיד:** יעד הפרסום. פוסטים, קטגוריות, תגיות, מדיה, Yoast.
- **API:** WordPress REST API — `/wp-json/wp/v2/...`.
- **אימות:** **Application Passwords** (מובנה ב-WP 5.6+) — לכל אתר.
- **נשמר מוצפן ב-Supabase לכל פרויקט:** `site_url`, `wp_username`, `wp_application_password`.
- **Yoast:** נדרש **mu-plugin** ייעודי בכל אתר (נספק) לחשיפת `_yoast_wpseo_focuskw` / `_title` / `_metadesc` ל-REST לכתיבה.
- **דורש מהמשתמש:** רשימת אתרי הלקוחות + משתמש admin בכל אתר עם הרשאה ליצור Application Password ולהתקין mu-plugin.
- **סטטוס:** ⏳ ממתין לרשימת אתרים ופרטי גישה.

### 3. Resend
- **תפקיד:** שליחת התראות מייל לאדמינים.
- **קונקטור:** מחובר (Resend MCP).
- **משתני סביבה נדרשים:**
  - `RESEND_API_KEY` (server-side בלבד)
- **דומיין שליחה:** _ייבדק/יוגדר (למשל domain מאומת תחת uriyaganor.com)._
- **נמענים:** 2 האדמינים.
- **סטטוס:** ⏳ ממתין לאימות דומיין/הגדרה.

---

### 4. Cloudflare (Hosting + DNS)
- **תפקיד:** אירוח ה-Worker (API + SPA assets) + ניהול DNS לסאב-דומיין.
- **קונקטור:** מחובר (Cloudflare MCP).
- **חשבונות זמינים:**
  - `Info@uriyaganor.com's Account` — `8b904080ccb2858612d4edba364d85b2`
  - `Orly@pop-art.co.il's Account` — `e059180d9c61ba4adbc6e5177ead2083`
- **סאב-דומיין:** `seo.uriyaganor.com` (ייווצר route/DNS ל-Worker).
- **Worker Secrets (פרודקשן):** `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `ENCRYPTION_KEY`.
- **סטטוס:** ⏳ ממתין להקמת Worker + בחירת חשבון.

### 5. GitHub (גיבוי קוד)
- **Repo:** `https://github.com/uriyagan/seodashboard`
- **תפקיד:** גיבוי שוטף של כל הפרויקט.
- **סטטוס:** 🔶 מחובר מקומית — ממתין לאימות הרשאת push.

---

## אימות והרשאות (Auth)

- **ספק:** Supabase Auth.
- **משתמשים מורשים:** 2 אדמינים בלבד.
  - אדמין 1: `info@uriyaganor.com`
  - אדמין 2: _טרם הוגדר._
- **מנגנון הגבלה:** _ייקבע (allowlist / RLS / role claim)._

---

## משתני סביבה — ריכוז (`.env`)

```
# Supabase (client)
VITE_SUPABASE_URL=https://jyhkgxkrapcrlcfgtekh.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Supabase (server — Worker Secret)
SUPABASE_SERVICE_ROLE_KEY=

# Gemini (Worker Secret)
GEMINI_API_KEY=

# Resend (Worker Secret)
RESEND_API_KEY=

# הצפנת סודות WordPress (Worker Secret)
ENCRYPTION_KEY=
```

> בפרודקשן הסודות (השורות ללא `VITE_`) נשמרים כ-**Cloudflare Worker Secrets** ולא בקובץ.

> ⚠️ קובץ `.env` לא יעלה ל-Git. יש להוסיף אותו ל-`.gitignore`.

---

## מיפוי Endpoints / API פנימי

_ימולא ככל שייבנה ה-Backend._

| Endpoint | Method | תיאור | שירותים בשימוש |
|----------|--------|--------|----------------|
| _TBD_ | | | |
