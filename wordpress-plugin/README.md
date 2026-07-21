# SEO Dashboard — Yoast REST Bridge (mu-plugin)

תוסף WordPress קטן שמאפשר ל-SEO Dashboard **לקרוא ולכתוב** את שדות ה-Yoast SEO דרך ה-REST API:
`Focus Keyword`, `SEO Title`, `Meta Description`.

## למה צריך אותו?
כברירת מחדל, WordPress **לא** מאפשר כתיבה ל-meta מוגן (שדות שמתחילים ב-`_`) דרך ה-REST API.
Yoast שומר את השדות האלה כ-meta מוגן, ולכן צריך "לפתוח" אותם לכתיבה — זה בדיוק מה שהתוסף עושה.

## חשוב: אי אפשר ב-wp-config.php
קוד זה רושם hooks (`add_action` / `register_post_meta`). `wp-config.php` נטען **לפני**
שמנגנון ה-hooks של WordPress קיים, ולכן קוד כזה שם יקרוס את האתר
(`undefined function add_action`). המקומות התקינים: mu-plugin (מומלץ) או functions.php של תבנית הבן.

## אפשרות א' (מומלצת) — קובץ drop-in ב-mu-plugins
mu-plugin **אינו "תוסף רגיל"**: זה קובץ שמניחים בתיקייה — ללא הפעלה, לא מופיע ברשימת התוספים,
אי אפשר לכבותו בטעות, ושורד עדכוני תבנית.
1. התחבר לאתר דרך FTP / מנהל קבצים.
2. עבור ל-`wp-content/`. אם אין תיקייה `mu-plugins` — צור אותה.
3. העלה את `seo-dashboard-yoast-bridge.php` אל `wp-content/mu-plugins/`.
4. זהו — נטען אוטומטית, ללא הפעלה.

## אפשרות ב' — סניפט ל-functions.php (תבנית בן)
אם אתה מעדיף להדביק לקובץ קיים: העתק את הבלוק מתוך `functions-snippet.php` לסוף
`functions.php` של **תבנית הבן**.
⚠️ ללא child theme, עדכון/החלפת תבנית עלול למחוק את הסניפט — לכן ה-mu-plugin עדיף ליציבות.

## בדיקה
לאחר ההתקנה, באשף "הוספת אתר חדש" ב-Dashboard, האתר יזוהה עם Yoast, ודחיפת פוסטים
תעדכן גם את שדות ה-Yoast. אם התוסף לא מותקן — הפוסטים עדיין נדחפים, אך שדות ה-SEO לא יתעדכנו.

## אבטחה
הכתיבה מותרת רק למשתמשים בעלי הרשאת `edit_posts` (עורך/מנהל), ורק דרך אימות תקין
(Application Password של המשתמש שחובר ל-Dashboard).
