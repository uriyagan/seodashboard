<?php
/**
 * SEO Dashboard — Companion snippet
 * ------------------------------------------------------------
 * לאתרים שחומת האש של האחסון (למשל SiteGround Anti-Bot) חוסמת אליהם גישה נכנסת
 * מהשרת. האתר יוצא *החוצה* אל הדשבורד, מושך משימות, מריץ אותן מקומית, ומחזיר
 * תוצאות — כך שהחסימה הנכנסת לא רלוונטית.
 *
 * התקנה: הדבק את כל הקוד הזה בסוף functions.php של תבנית הבן (או ב-mu-plugin).
 * החלף PASTE_PROJECT_TOKEN_HERE בטוקן של הפרויקט מתוך הדשבורד (מסך ההגדרות).
 *
 * ⚠️ לא ב-wp-config.php.
 */

if (!defined('ABSPATH')) exit;

define('SEO_DASH_URL', 'https://seo.uriyaganor.com');
define('SEO_DASH_TOKEN', 'PASTE_PROJECT_TOKEN_HERE');

// --- Yoast REST fields (so pushes can update the SEO fields) ---
add_action('init', function () {
    foreach (['_yoast_wpseo_focuskw', '_yoast_wpseo_title', '_yoast_wpseo_metadesc'] as $k) {
        register_post_meta('post', $k, [
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ]);
    }
});

// --- Poll every minute via WP-Cron ---
add_filter('cron_schedules', function ($s) {
    $s['seo_dash_min'] = ['interval' => 60, 'display' => 'SEO Dashboard poll'];
    return $s;
});
add_action('init', function () {
    if (!wp_next_scheduled('seo_dash_poll')) {
        wp_schedule_event(time() + 10, 'seo_dash_min', 'seo_dash_poll');
    }
});
add_action('seo_dash_poll', 'seo_dash_run_jobs');

// --- Also poll opportunistically on page loads (throttled ~15s) for responsiveness ---
add_action('init', function () {
    if (time() - (int) get_transient('seo_dash_last_poll') >= 15) {
        set_transient('seo_dash_last_poll', time(), 60);
        seo_dash_run_jobs();
    }
});

function seo_dash_post($path, $payload) {
    return wp_remote_post(SEO_DASH_URL . $path, [
        'headers' => ['Content-Type' => 'application/json'],
        'body'    => wp_json_encode($payload),
        'timeout' => 20,
    ]);
}

function seo_dash_run_jobs() {
    if (SEO_DASH_TOKEN === 'PASTE_PROJECT_TOKEN_HERE') return;

    $res = seo_dash_post('/api/companion/claim', ['token' => SEO_DASH_TOKEN, 'limit' => 10]);
    if (is_wp_error($res)) return;
    $data = json_decode(wp_remote_retrieve_body($res), true);
    $jobs = isset($data['jobs']) ? $data['jobs'] : [];
    if (!$jobs) return;

    // Act as an administrator so internal REST permission checks pass.
    $admins = get_users(['role' => 'administrator', 'number' => 1, 'fields' => 'ID']);
    if (!empty($admins)) wp_set_current_user((int) $admins[0]);

    $server = rest_get_server();
    foreach ($jobs as $job) {
        $r = isset($job['request']) ? $job['request'] : [];
        $method = isset($r['method']) ? strtoupper($r['method']) : 'GET';
        $req = new WP_REST_Request($method, isset($r['route']) ? $r['route'] : '/');
        if (!empty($r['query'])) {
            foreach ($r['query'] as $k => $v) $req->set_param($k, $v);
        }
        if (isset($r['body'])) {
            $req->set_body(wp_json_encode($r['body']));
            $req->set_header('Content-Type', 'application/json');
        }
        $response = rest_do_request($req);
        seo_dash_post('/api/companion/complete', [
            'token'  => SEO_DASH_TOKEN,
            'jobId'  => $job['id'],
            'result' => [
                'status'  => $response->get_status(),
                'headers' => $response->get_headers(),
                'body'    => $server->response_to_data($response, false),
            ],
        ]);
    }
}
