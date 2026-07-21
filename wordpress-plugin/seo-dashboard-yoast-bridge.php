<?php
/**
 * Plugin Name: SEO Dashboard — Yoast REST Bridge
 * Description: חושף את שדות ה-Yoast SEO (Focus Keyword / SEO Title / Meta Description) ל-REST API כדי שה-SEO Dashboard יוכל לקרוא ולכתוב אותם.
 * Version:     1.0.0
 * Author:      Uri Yaganor
 *
 * התקנה: העלה קובץ זה לתיקייה  wp-content/mu-plugins/
 * (אם התיקייה לא קיימת — צור אותה). תוספי mu-plugins נטענים אוטומטית,
 * אין צורך "להפעיל" אותם בממשק.
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

add_action('init', function () {
    $keys = array(
        '_yoast_wpseo_focuskw',
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
    );

    foreach ($keys as $key) {
        register_post_meta('post', $key, array(
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () {
                // Only users who can edit posts may read/write these fields.
                return current_user_can('edit_posts');
            },
        ));
    }
});
