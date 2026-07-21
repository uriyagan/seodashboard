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
- **מודלים (ניתנים לשינוי דרך env):**
  - טקסט: `gemini-3-pro` (ברירת מחדל; משתנה `GEMINI_TEXT_MODEL`).
  - תמונות (Nano Banana 2): `gemini-3.1-flash-image` (משתנה `GEMINI_IMAGE_MODEL`).
- **דורש:** חשבון Google AI Studio / Google Cloud עם חיוב מופעל למודל התמונות.
- **סטטוס:** ⏳ ממתין למפתח API.

### 2b. WordPress — אתרי לקוחות
- **תפקיד:** יעד הפרסום. פוסטים, קטגוריות, תגיות, מדיה, Yoast.
- **API:** WordPress REST API — `/wp-json/wp/v2/...`.
- **אימות:** **Application Passwords** (מובנה ב-WP 5.6+) — לכל אתר.
- **נשמר מוצפן ב-Supabase לכל פרויקט:** `site_url`, `wp_username`, `wp_application_password`.
- **Yoast:** בכל אתר מוסיפים **סניפט ל-`functions.php` של תבנית הבן** (השיטה שנבחרה; ראה `wordpress-plugin/functions-snippet.php`) לחשיפת `_yoast_wpseo_focuskw` / `_title` / `_metadesc` ל-REST לכתיבה.
- **דורש מהמשתמש:** רשימת אתרי הלקוחות + משתמש admin בכל אתר עם הרשאה ליצור Application Password ולהתקין mu-plugin.
- **סטטוס:** ⏳ ממתין לרשימת אתרים ופרטי גישה.

### 3. Resend
- **תפקיד:** שליחת התראות מייל לאדמינים.
- **קונקטור:** מחובר (Resend MCP).
- **דומיין שליחה:** `service.uriyaganor.com` — **מאומת** (sending enabled).
- **כתובת שולח:** `noreply@service.uriyaganor.com` (`RESEND_FROM`).
- **API key:** נוצר מפתח ייעודי בשם `seo-dashboard`, מוגבל ל-sending בלבד ולדומיין זה. הערך נשמר ב-`.env.local` (dev) — בפרודקשן כ-Worker Secret. **לא נשמר במסמכים/בגיט.**
- **נמענים:** `info@uriyaganor.com`, `sam@uriyaganor.com` (`ADMIN_EMAILS`).
- **סטטוס:** ✅ מוגדר (dev). לפרודקשן: `wrangler secret put RESEND_API_KEY`.

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

- **ספק:** Supabase Auth (אימייל + סיסמה).
- **משתמשים מורשים:** 2 אדמינים בלבד (allowlist).
  - אדמין 1: `info@uriyaganor.com`
  - אדמין 2: `sam@uriyaganor.com`
- **מסך התחברות:** "זכור אותי" (persistent session), "שכחתי סיסמה" (reset email).
- **קביעת סיסמה:** דרך invite/reset של Supabase או ידנית ב-Dashboard — **הסיסמה לא נשמרת בקוד/בגיט/במסמכים**.
- **מנגנון הגבלה:** allowlist של שני המיילים + RLS. משתמש שאינו ברשימה — נחסם.

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

> כל ה-endpoints תחת `/api/*` מוגשים ע"י Cloudflare Worker (Hono), דורשים Bearer token של Supabase, ומאמתים `is_admin()`.

| Endpoint | Method | תיאור | שירותים |
|----------|--------|--------|----------|
| `/api/health` | GET | בדיקת חיים | — |
| `/api/projects/check-url` | POST | בדיקת זמינות `/wp-json` (שלב 1 באשף) | WordPress |
| `/api/projects/test-connection` | POST | אימות Application Password + זיהוי Yoast (שלב 2) | WordPress |
| `/api/projects/connect` | POST | יצירת פרויקט (סיסמה מוצפנת AES-GCM) + סנכרון מיידי (שלב 3) | WordPress, Supabase |
| `/api/projects/:id/sync` | POST | סנכרון מחדש של פוסטים/טקסונומיות | WordPress, Supabase |
| `/api/projects/:id/posts/:wpId` | GET | משיכת תוכן מלא + Yoast של פוסט (לעריכה) | WordPress |
| `/api/projects/:id/posts/push` | POST | דחיפת פוסט כטיוטה + Yoast + קטגוריות/תגיות | WordPress, Supabase |
| `/api/projects/:id/terms` | POST | יצירת קטגוריה/תגית חדשה | WordPress, Supabase |
| `/api/projects/:id/media` | POST | העלאת תמונה למדיה של WP | WordPress |
| `/api/projects/:id/ai/write` | POST | כתיבת מאמר עם Gemini (content_prompt) | Gemini |
| `/api/projects/:id/ai/image` | POST | יצירת תמונה (Nano Banana 2) + העלאה למדיה | Gemini, WordPress |
| `/api/projects/:id/ideas/generate` | POST | 10 רעיונות מ-Gemini לפי כותרות קיימות | Gemini, Supabase |
| `/api/projects/:id/ideas/:ideaId/write` | POST | כתיבת פוסט מרעיון (מאמר+תמונה) → טיוטה מקומית | Gemini, WordPress, Supabase |
| `/api/monitor/run` | POST | הרצת ניטור הקצב ידנית (זהה ל-Cron) | Supabase, Resend |
| `scheduled` (Cron) | — | ניטור יומי אוטומטי (06:00 UTC) | Supabase, Resend |

**הצפנת סודות WP:** ה-Application Password מוצפן ב-Worker (AES-GCM, `ENCRYPTION_KEY`) ונשמר כ-ciphertext ב-`projects.wp_app_password_encrypted`. פענוח מתבצע רק בצד השרת בעת סנכרון.
**אימות API:** ה-Frontend שולח את ה-access token של Supabase; ה-Worker פונה ל-Supabase עם ה-token (RLS חל) ומאמת `is_admin()`.
