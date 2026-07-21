<?php
/**
 * SEO Dashboard — Yoast REST snippet (חלופה ל-mu-plugin)
 * ------------------------------------------------------------
 * הדבק את הקוד שבתוך הבלוק למטה בסוף functions.php של תבנית הבן (child theme).
 *
 * ⚠️ אין להדביק ב-wp-config.php! שם add_action עדיין לא קיים והאתר יקרוס.
 *    המקומות התקינים לקוד זה: mu-plugin (מומלץ) או functions.php של תבנית הבן.
 */

// ===== העתק מכאן =====
add_action('init', function () {
    $keys = array('_yoast_wpseo_focuskw', '_yoast_wpseo_title', '_yoast_wpseo_metadesc');
    foreach ($keys as $key) {
        register_post_meta('post', $key, array(
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () {
                return current_user_can('edit_posts');
            },
        ));
    }
});
// ===== עד כאן =====
