# SEO Dashboard — מדריך פריסה (Cloudflare)

פריסה ל-Cloudflare Workers עם סאב-דומיין `seo.uriyaganor.com`.

**עודכן:** 2026-07-21

---

## דרישות מקדימות
- חשבון Cloudflare (זמינים: `info@uriyaganor.com` או `orly@pop-art.co.il`).
- הדומיין `uriyaganor.com` מנוהל ב-Cloudflare (Zone קיים).
- Node 18+ ו-`wrangler` (מותקן כתלות dev בפרויקט).

---

## שלב 1 — התחברות ל-Cloudflare
```bash
npx wrangler login
```

## שלב 2 — הגדרת ה-Secrets (פרודקשן)
כל הסודות נשמרים כ-Worker Secrets (לא בקוד, לא ב-git):
```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # לניטור ה-Cron
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM                 # לדוגמה: SEO Dashboard <noreply@mail.uriyaganor.com>
npx wrangler secret put ADMIN_EMAILS                # info@uriyaganor.com,sam@uriyaganor.com
npx wrangler secret put ENCRYPTION_KEY              # base64 של 32 בתים (חדש, נפרד מהפיתוח)
```
> ⚠️ **חשוב:** `ENCRYPTION_KEY` בפרודקשן חייב להיות קבוע. אם הוא ישתנה, לא ניתן יהיה
> לפענח את סיסמאות ה-WordPress הקיימות ויידרש חיבור מחדש של האתרים.

יצירת מפתח הצפנה חדש:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## שלב 3 — משתני VITE (build-time)
משתני `VITE_` נצרבים ב-build של ה-Frontend. ודא שקיים `.env.local` (או הגדר ב-CI):
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

## שלב 4 — פריסה
```bash
npm run deploy      # = npm run build && wrangler deploy
```

## שלב 5 — סאב-דומיין
1. ב-Cloudflare Dashboard → Workers & Pages → הפרויקט → **Custom Domains**.
2. הוסף `seo.uriyaganor.com` (Cloudflare יצור רשומת DNS אוטומטית כי ה-Zone מנוהל שם).

## שלב 6 — Cron
ה-Cron מוגדר ב-`wrangler.jsonc` (`triggers.crons: ["0 6 * * *"]`) ונפרס אוטומטית עם ה-Worker.
בדיקה ידנית מהממשק: קריאה ל-`POST /api/monitor/run` (אדמין) או `wrangler dev` + trigger.

---

## הגדרות Supabase Auth (חד-פעמי)
1. **Site URL:** `https://seo.uriyaganor.com` (Authentication → URL Configuration).
2. **Redirect URLs:** הוסף `https://seo.uriyaganor.com/reset-password`.
3. **SMTP (מומלץ):** חבר את Supabase Auth לשליחה דרך **Resend** לאמינות מיילי הזמנה/איפוס.
4. **משתמשים:** הזמן את `info@uriyaganor.com` ו-`sam@uriyaganor.com` (Invite).

## התקנת ה-mu-plugin בכל אתר לקוח
ראה `wordpress-plugin/README.md` — העלאת `seo-dashboard-yoast-bridge.php` ל-`wp-content/mu-plugins/`.
