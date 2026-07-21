# SEO Dashboard — Yoast REST Bridge (mu-plugin)

תוסף WordPress קטן שמאפשר ל-SEO Dashboard **לקרוא ולכתוב** את שדות ה-Yoast SEO דרך ה-REST API:
`Focus Keyword`, `SEO Title`, `Meta Description`.

## למה צריך אותו?
כברירת מחדל, WordPress **לא** מאפשר כתיבה ל-meta מוגן (שדות שמתחילים ב-`_`) דרך ה-REST API.
Yoast שומר את השדות האלה כ-meta מוגן, ולכן צריך "לפתוח" אותם לכתיבה — זה בדיוק מה שהתוסף עושה.

## התקנה (פעם אחת לכל אתר לקוח)
1. התחבר לאתר ה-WordPress דרך FTP / מנהל קבצים (או תוסף כמו "File Manager").
2. עבור לתיקייה `wp-content/`.
3. אם אין תיקייה בשם `mu-plugins` — צור אותה.
4. העלה את הקובץ `seo-dashboard-yoast-bridge.php` אל `wp-content/mu-plugins/`.
5. זהו. תוספי `mu-plugins` נטענים אוטומטית — **אין צורך להפעיל** דבר בממשק.

## בדיקה
לאחר ההתקנה, באשף "הוספת אתר חדש" ב-Dashboard, האתר יזוהה עם Yoast, ודחיפת פוסטים
תעדכן גם את שדות ה-Yoast. אם התוסף לא מותקן — הפוסטים עדיין נדחפים, אך שדות ה-SEO לא יתעדכנו.

## אבטחה
הכתיבה מותרת רק למשתמשים בעלי הרשאת `edit_posts` (עורך/מנהל), ורק דרך אימות תקין
(Application Password של המשתמש שחובר ל-Dashboard).
