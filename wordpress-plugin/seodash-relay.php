<?php
/**
 * SEODASH static-IP relay.
 *
 * Deploy this single file on ANY server that has a STABLE outbound IP and PHP
 * with cURL (a small VPS, or a host you control). The SEODASH Worker sends
 * blocked WordPress requests here; this script performs them from THIS server's
 * IP and returns the response. Whitelist THIS server's IP in each site's host
 * anti-bot (e.g. SiteGround support ticket) and the dashboard reaches the site
 * directly — no per-site snippet, real-time.
 *
 * Setup:
 *   1. Put this file somewhere web-accessible over HTTPS, e.g.
 *      https://relay.yourdomain.com/seodash-relay.php
 *   2. Set the secret below (a long random string) and set the SAME value as
 *      the Worker secret RELAY_SECRET, and this file's URL as RELAY_URL.
 *   3. Whitelist this server's outbound IP in each client's host anti-bot.
 */

// A long random shared secret. MUST match the Worker's RELAY_SECRET.
$RELAY_SECRET = getenv('SEODASH_RELAY_SECRET') ?: 'CHANGE_ME_TO_A_LONG_RANDOM_SECRET';

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method not allowed']);
    exit;
}

$raw = file_get_contents('php://input');
$in = json_decode($raw, true);
if (!is_array($in)) {
    http_response_code(400);
    echo json_encode(['error' => 'bad request']);
    exit;
}

// Authorize (constant-time).
if (!isset($in['secret']) || !hash_equals($RELAY_SECRET, (string) $in['secret'])) {
    http_response_code(403);
    echo json_encode(['error' => 'forbidden']);
    exit;
}

$url = isset($in['url']) ? (string) $in['url'] : '';
$parts = parse_url($url);
if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid url (https required)']);
    exit;
}

// Basic SSRF guard: refuse internal / private hosts.
$host = strtolower($parts['host']);
$ip = filter_var($host, FILTER_VALIDATE_IP) ? $host : gethostbyname($host);
if (
    $host === 'localhost' ||
    preg_match('/^(127\.|10\.|192\.168\.|169\.254\.|::1)/', $host) ||
    ($ip && (
        preg_match('/^(127\.|10\.|192\.168\.|169\.254\.)/', $ip) ||
        preg_match('/^172\.(1[6-9]|2\d|3[01])\./', $ip)
    ))
) {
    http_response_code(400);
    echo json_encode(['error' => 'blocked host']);
    exit;
}

$method = strtoupper(isset($in['method']) ? (string) $in['method'] : 'GET');
$headers = [];
if (isset($in['headers']) && is_array($in['headers'])) {
    foreach ($in['headers'] as $k => $v) {
        $headers[] = $k . ': ' . $v;
    }
}

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_ENCODING       => '', // accept gzip
]);
if ($method !== 'GET' && isset($in['body']) && $in['body'] !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, (string) $in['body']);
}

// Collect response headers we care about (pagination + content type).
$respHeaders = [];
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $line) use (&$respHeaders) {
    $len = strlen($line);
    $p = strpos($line, ':');
    if ($p !== false) {
        $name = strtolower(trim(substr($line, 0, $p)));
        $val = trim(substr($line, $p + 1));
        if (in_array($name, ['content-type', 'x-wp-total', 'x-wp-totalpages'], true)) {
            $respHeaders[$name] = $val;
        }
    }
    return $len;
});

$body = curl_exec($ch);
if ($body === false) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream: ' . curl_error($ch)]);
    curl_close($ch);
    exit;
}
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo json_encode([
    'status'  => $status,
    'headers' => $respHeaders,
    'body'    => $body,
]);
