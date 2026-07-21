# SEO Dashboard

דאשבורד ניהול לסוכנות קידום אורגני — הפקת תוכן לבלוגים ב-WordPress עבור מספר לקוחות, עם כתיבה מבוססת AI, יצירת תמונות, וניהול Yoast SEO.

**דומיין:** `seo.uriyaganor.com` · **גישה:** אדמינים בלבד (2 משתמשים)

---

## תיעוד

- 📄 [docs/PLAN.md](docs/PLAN.md) — תוכנית הפרויקט המלאה ושלבי הביצוע.
- 🏗️ [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — ארכיטקטורה, רכיבים וזרימות.
- 🔌 [docs/CONNECTIONS.md](docs/CONNECTIONS.md) — חיבורים, שירותים חיצוניים, API ומשתני סביבה.
- 📋 [docs/HANDOFF.md](docs/HANDOFF.md) — מצב נוכחי, החלטות ולוג התקדמות.

---

## Stack (מוצע)

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React + Vite + TypeScript + Tailwind |
| עורך | TipTap (HTML נקי תואם WordPress) |
| Backend / API | Cloudflare Workers (Hono) |
| DB + Auth + Storage | Supabase |
| AI טקסט | Google Gemini |
| AI תמונות | Nano Banana 2 (Gemini Image) |
| מייל | Resend |
| Hosting + DNS | Cloudflare (Workers + DNS) |

---

## פיצ'רים מרכזיים

1. סוויצ'ר פרויקטים (לקוח = אתר WordPress).
2. יצירה ועריכה של פוסטים (סנכרון מול WordPress REST).
3. כתיבת פוסטים עם Gemini.
4. יצירת תמונות עם Nano Banana 2.
5. שדות Yoast SEO + דחיפה לאתר (Focus Keyword / SEO Title / Meta Description).
6. "הצע לי רעיונות חדשים" → 10 רעיונות → כתיבה אוטומטית של פוסט + תמונה.

---

## פיתוח מקומי

```bash
npm install
cp .env.example .env.local   # מלא ערכים
npm run dev
```

> ⚠️ `.env.local` לא עולה ל-git. סודות פרודקשן נשמרים כ-Cloudflare Worker Secrets.
