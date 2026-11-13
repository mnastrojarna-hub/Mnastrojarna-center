<?php
/**
 * Mnástrojárna CAD – úložiště sdílených odkazů (krátký odkaz  https://www.mnastrojarna.cz/cad#q=<id>.<klíč>).
 *
 * Prohlížeč dokument zašifruje (AES-GCM) náhodným klíčem, který je JEN v odkazu za „#“ (ta část se na server nikdy
 * neposílá). Sem se nahrává jen neprůhledný šifrovaný blob – server ho nedokáže přečíst.
 *
 *   GET    ?ping                                  → {"ok":true,"max_bytes":…,"chunk_bytes":…,"max_days":90}
 *   POST   ?days=1..90&total=<bajtů>   (tělo = blob nebo jeho 1. část, Content-Type: application/octet-stream)
 *                                                 → 201 {"id","del","exp","size","done"}
 *   POST   ?id=<id>&offset=<bajtů>     (další část; hlavička X-Delete-Token) → {"id","size","done"}
 *   GET    ?id=<id>                               → blob | 404 neexistuje | 410 vypršel
 *   DELETE ?id=<id>                    (hlavička X-Delete-Token nebo ?del=) → {"ok":true}
 *
 * Data: přednostně MIMO webový kořen (o úroveň výš: <rodič DOCUMENT_ROOT>/cad-share-data), jinak složka „data“ vedle
 * tohoto skriptu chráněná .htaccess (Require all denied / Deny from all) + index.html. Soubory nikdy nejsou spustitelné
 * (.bin / .json). Vypršelá data se mažou průběžně při požadavcích (nejvýš jednou za 10 minut, omezená dávka).
 * Ochrana: limit velikosti, počet nových sdílení a objem dat za hodinu z jedné IP (IP se neukládá, jen její otisk se
 * solí), celková kvóta, jen POST/GET/DELETE, zápis jen ze stejného původu (Origin / Sec-Fetch-Site), žádné CORS.
 *
 * Funguje na PHP 7.4 i 8.x bez rozšíření (jen standardní funkce). Nastavení níže lze měnit.
 */
declare(strict_types=1);

@ini_set('display_errors', '0'); // varování nesmí rozbít binární odpověď
@ini_set('zlib.output_compression', '0'); // délka odpovědi = velikost obsahu (Content-Length)

// ───────── nastavení ─────────
const MN_MAX_BYTES = 25 * 1024 * 1024;   // největší sdílený (šifrovaný) dokument
const MN_MAX_DAYS = 90;                  // nejdelší platnost
const MN_CHUNK_MAX = 8 * 1024 * 1024;    // největší část jednoho požadavku (menší, je-li post_max_size menší)
const MN_RATE_COUNT = 40;                // nových sdílení za hodinu z jedné IP
const MN_RATE_BYTES = 300 * 1024 * 1024; // nahraných bajtů za hodinu z jedné IP
const MN_RATE_WINDOW = 3600;
const MN_QUOTA_BYTES = 3 * 1024 * 1024 * 1024; // celkem uložených dat
const MN_PARTIAL_TTL = 3600;             // nedokončené nahrávání se zahodí po hodině
const MN_GC_INTERVAL = 600;              // úklid nejvýš jednou za 10 minut
const MN_GC_BATCH = 3000;                // a nejvýš tolik souborů najednou
const MN_ID_LEN = 10;                    // délka id (base62, ~59 bitů)

const MN_B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** nastavení z prostředí (jen pro testy / vlastní server; na sdíleném hostingu není nastaveno) */
function mn_env_int(string $name, int $def): int
{
    $v = getenv($name);
    return ($v !== false && $v !== '' && ctype_digit($v)) ? (int)$v : $def;
}
function mn_max_bytes(): int { return mn_env_int('MN_SHARE_MAX_BYTES', MN_MAX_BYTES); }
function mn_rate_count(): int { return mn_env_int('MN_SHARE_RATE', MN_RATE_COUNT); }
function mn_quota(): int { return mn_env_int('MN_SHARE_QUOTA', MN_QUOTA_BYTES); }

// ───────── odpovědi ─────────
function mn_json(int $status, array $data, array $extra = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    foreach ($extra as $h) header($h);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}
function mn_fail(int $status, string $error, array $more = [], array $extra = []): void
{
    mn_json($status, ['ok' => false, 'error' => $error] + $more, $extra);
}

// ───────── úložiště ─────────
function mn_protect(string $dir): void
{
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "# Mnástrojárna CAD – šifrovaná data sdílených odkazů: nikdy nezveřejňovat\n"
            . "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n"
            . "<IfModule mod_php.c>\n  php_flag engine off\n</IfModule>\n"
            . "<IfModule mod_php7.c>\n  php_flag engine off\n</IfModule>\n");
    }
    if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
    if (!is_file($dir . '/web.config')) {
        // IIS (pro jistotu): zakázat vše
        @file_put_contents($dir . '/web.config', "<?xml version=\"1.0\"?>\n<configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n");
    }
}

function mn_data_dir(): string
{
    static $dir = null;
    if ($dir !== null) return $dir;
    $env = getenv('MN_SHARE_DATA');
    $cands = [];
    if ($env !== false && $env !== '' && $env !== 'local') $cands[] = rtrim($env, '/');
    if ($env !== 'local') {
        $root = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
        $real = $root !== '' ? @realpath($root) : false;
        if ($real && dirname($real) !== $real) $cands[] = dirname($real) . '/cad-share-data';
    }
    $cands[] = __DIR__ . '/data';
    foreach ($cands as $c) {
        if (@is_dir($c)) {
            if (!@is_writable($c)) continue;
        } elseif (!@is_writable(dirname($c)) || !@mkdir($c, 0700)) {
            continue;
        }
        mn_protect($c);
        if (!@is_dir($c . '/rl')) @mkdir($c . '/rl', 0700);
        return $dir = $c;
    }
    mn_fail(503, 'storage_unavailable');
    return '';
}

function mn_valid_id(string $id): bool
{
    return (bool)preg_match('/^[0-9A-Za-z]{8,12}$/D', $id);
}
function mn_rand62(int $n): string
{
    $out = '';
    while (strlen($out) < $n) {
        foreach (str_split(random_bytes($n * 2)) as $ch) {
            $b = ord($ch);
            if ($b < 248) $out .= MN_B62[$b % 62]; // 248 = 4 × 62: bez zkreslení
            if (strlen($out) === $n) break;
        }
    }
    return $out;
}
function mn_paths(string $id): array
{
    $d = mn_data_dir();
    return ['meta' => "$d/$id.json", 'bin' => "$d/$id.bin", 'part' => "$d/$id.part"];
}
function mn_read_meta(string $file): ?array
{
    $s = @file_get_contents($file);
    if ($s === false) return null;
    $m = json_decode($s, true);
    return is_array($m) ? $m : null;
}
function mn_write_meta(string $file, array $m): bool
{
    $tmp = $file . '.' . mn_rand62(6) . '.tmp';
    if (@file_put_contents($tmp, json_encode($m)) === false) return false;
    return @rename($tmp, $file);
}
function mn_remove(string $id): void
{
    $p = mn_paths($id);
    @unlink($p['bin']);
    @unlink($p['part']);
    @unlink($p['meta']);
}

// ───────── úklid vypršelých dat (líně, omezená dávka) ─────────
function mn_gc(bool $force = false): void
{
    $d = mn_data_dir();
    $stamp = "$d/.gc";
    $now = time();
    $last = @filemtime($stamp);
    if (!$force && $last !== false && $now - $last < MN_GC_INTERVAL) return;
    @touch($stamp);
    $h = @opendir($d);
    if (!$h) return;
    $seen = 0;
    $usage = 0;
    $complete = true;
    while (($f = readdir($h)) !== false) {
        if ($seen >= MN_GC_BATCH) {
            $complete = false;
            break;
        }
        if (substr($f, -5) === '.json') {
            $seen++;
            $id = substr($f, 0, -5);
            if (!mn_valid_id($id)) continue;
            $m = mn_read_meta("$d/$f");
            $dead = !$m || ($m['exp'] ?? 0) < $now || (empty($m['done']) && ($m['created'] ?? 0) + MN_PARTIAL_TTL < $now);
            if ($dead) mn_remove($id);
            else $usage += (int)($m['total'] ?? 0);
        } elseif (substr($f, -4) === '.tmp' && ($t = @filemtime("$d/$f")) !== false && $now - $t > 600) {
            @unlink("$d/$f");
        }
    }
    closedir($h);
    if ($complete) @file_put_contents("$d/.usage", (string)$usage);
    // počítadla IP po uplynutí okna
    $rl = @opendir("$d/rl");
    if ($rl) {
        $n = 0;
        while (($f = readdir($rl)) !== false && $n++ < MN_GC_BATCH) {
            if ($f[0] === '.') continue;
            $t = @filemtime("$d/rl/$f");
            if ($t !== false && $now - $t > MN_RATE_WINDOW) @unlink("$d/rl/$f");
        }
        closedir($rl);
    }
}

// ───────── ochrana proti zneužití ─────────
function mn_secret(): string
{
    $f = mn_data_dir() . '/.secret';
    $s = @file_get_contents($f);
    if ($s === false || strlen($s) < 32) {
        $s = bin2hex(random_bytes(32));
        @file_put_contents($f, $s);
    }
    return $s;
}
/** počet nových sdílení a bajtů z této IP v aktuálním okně; $add = započítat nahrání */
function mn_rate(int $addBytes, bool $newShare): ?string
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '0');
    $f = mn_data_dir() . '/rl/' . substr(hash('sha256', mn_secret() . '|' . $ip), 0, 32);
    $fh = @fopen($f, 'c+');
    if (!$fh) return null; // bez počítadla raději nahrát než odmítnout
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $st = json_decode($raw ?: '', true);
    $now = time();
    if (!is_array($st) || $now - (int)($st['t'] ?? 0) > MN_RATE_WINDOW) $st = ['t' => $now, 'n' => 0, 'b' => 0];
    $err = null;
    if ($newShare && $st['n'] >= mn_rate_count()) $err = 'rate_limited';
    elseif ($st['b'] + $addBytes > MN_RATE_BYTES) $err = 'rate_limited';
    else {
        if ($newShare) $st['n']++;
        $st['b'] += $addBytes;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($st));
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    if ($err) return (string)max(1, MN_RATE_WINDOW - ($now - (int)$st['t']));
    return null;
}
function mn_same_origin(): bool
{
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '' && $site !== 'same-origin' && $site !== 'none') return false;
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '' || $origin === 'null') return $origin === '';
    $u = parse_url($origin);
    if (!$u || empty($u['host'])) return false;
    $host = strtolower($u['host'] . (isset($u['port']) ? ':' . $u['port'] : ''));
    $self = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    // výchozí porty se v Host neuvádějí
    $self = preg_replace('/:(80|443)$/', '', $self);
    $host = preg_replace('/:(80|443)$/', '', $host);
    return $self !== '' && hash_equals($self, $host);
}
function mn_post_max(): int
{
    $v = trim((string)ini_get('post_max_size'));
    if ($v === '' || $v === '0') return 0;
    $n = (int)$v;
    $u = strtolower(substr($v, -1));
    if ($u === 'g') $n *= 1024 ** 3;
    elseif ($u === 'm') $n *= 1024 ** 2;
    elseif ($u === 'k') $n *= 1024;
    return $n;
}
function mn_chunk_bytes(): int
{
    $c = mn_env_int('MN_SHARE_CHUNK', MN_CHUNK_MAX);
    $pm = mn_post_max();
    if ($pm > 0) $c = min($c, max(256 * 1024, $pm - 64 * 1024));
    return $c;
}
function mn_token(): string
{
    $t = (string)($_SERVER['HTTP_X_DELETE_TOKEN'] ?? '');
    if ($t === '') $t = mn_str_param('del');
    return preg_match('/^[0-9A-Za-z]{16,64}$/D', $t) ? $t : '';
}
function mn_str_param(string $k): string
{
    $v = $_GET[$k] ?? '';
    return is_string($v) ? $v : '';
}
function mn_int_param(string $k): ?int
{
    $v = $_GET[$k] ?? null;
    if (!is_string($v) || !preg_match('/^\d{1,12}$/D', $v)) return null;
    return (int)$v;
}

/**
 * Připojí tělo požadavku k souboru. Pozice se ověří pod zámkem: soubor musí mít právě $offset bajtů.
 * Vrátí počet zapsaných bajtů, -1 při překročení $limit, -2 při nesouhlasné pozici.
 */
function mn_store_body(string $file, int $limit, int $offset): int
{
    $in = fopen('php://input', 'rb');
    $out = @fopen($file, 'cb');
    if (!$in || !$out) mn_fail(503, 'storage_unavailable');
    flock($out, LOCK_EX);
    $st = fstat($out);
    if (!$st || (int)$st['size'] !== $offset) {
        flock($out, LOCK_UN);
        fclose($out);
        fclose($in);
        return -2;
    }
    fseek($out, 0, SEEK_END);
    $n = 0;
    $over = false;
    while (!feof($in)) {
        $buf = fread($in, 65536);
        if ($buf === false || $buf === '') {
            if ($buf === false) break;
            continue;
        }
        $n += strlen($buf);
        if ($n > $limit) {
            $over = true;
            break;
        }
        fwrite($out, $buf);
    }
    fflush($out);
    flock($out, LOCK_UN);
    fclose($out);
    fclose($in);
    return $over ? -1 : $n;
}

// ───────── požadavek ─────────
header_remove('X-Powered-By');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header('Vary: Origin');

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$allow = ['Allow: GET, POST, DELETE'];

if ($method === 'GET' && isset($_GET['ping'])) {
    mn_data_dir();
    mn_gc();
    mn_json(200, ['ok' => true, 'v' => 1, 'max_bytes' => mn_max_bytes(), 'chunk_bytes' => mn_chunk_bytes(), 'max_days' => MN_MAX_DAYS]);
}

if ($method === 'GET') {
    $id = mn_str_param('id');
    if (!mn_valid_id($id)) mn_fail(400, 'invalid_id');
    mn_gc();
    $p = mn_paths($id);
    $m = mn_read_meta($p['meta']);
    if (!$m || empty($m['done']) || !is_file($p['bin'])) mn_fail(404, 'not_found');
    $now = time();
    if ((int)$m['exp'] < $now) {
        mn_remove($id);
        mn_fail(410, 'expired', ['exp' => (int)$m['exp']]);
    }
    $size = filesize($p['bin']);
    http_response_code(200);
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . $size);
    header('Content-Disposition: attachment; filename="mncad-share.bin"');
    header('Cache-Control: private, max-age=' . max(0, min(3600, (int)$m['exp'] - $now)));
    header('X-Share-Expires: ' . (int)$m['exp']);
    header("Content-Security-Policy: default-src 'none'; sandbox");
    readfile($p['bin']);
    exit;
}

if ($method === 'POST') {
    if (!mn_same_origin()) mn_fail(403, 'cross_origin');
    $ct = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if ($ct !== 'application/octet-stream') mn_fail(415, 'content_type');
    $len = isset($_SERVER['CONTENT_LENGTH']) && ctype_digit((string)$_SERVER['CONTENT_LENGTH']) ? (int)$_SERVER['CONTENT_LENGTH'] : -1;
    $chunkMax = mn_chunk_bytes();
    if ($len > $chunkMax) mn_fail(413, 'chunk_too_large', ['chunk_bytes' => $chunkMax]);
    mn_gc();

    // další část rozpracovaného nahrávání
    if (mn_str_param('id') !== '') {
        $id = mn_str_param('id');
        if (!mn_valid_id($id)) mn_fail(400, 'invalid_id');
        $tok = mn_token();
        $offset = mn_int_param('offset');
        $p = mn_paths($id);
        $m = mn_read_meta($p['meta']);
        if (!$m || !empty($m['done'])) mn_fail(404, 'not_found');
        if ($tok === '' || !hash_equals((string)$m['del'], hash('sha256', $tok))) mn_fail(403, 'bad_token');
        if ((int)$m['created'] + MN_PARTIAL_TTL < time()) {
            mn_remove($id);
            mn_fail(410, 'expired');
        }
        clearstatcache(true, $p['part']);
        $have = is_file($p['part']) ? (int)filesize($p['part']) : 0;
        if ($offset === null || $offset !== $have) mn_fail(409, 'offset', ['size' => $have]);
        $total = (int)$m['total'];
        if ($len >= 0 && $have + $len > $total) mn_fail(413, 'too_large', ['max_bytes' => mn_max_bytes()]);
        if (($retry = mn_rate(max(0, $len), false)) !== null) mn_fail(429, 'rate_limited', [], ['Retry-After: ' . $retry]);
        $n = mn_store_body($p['part'], $total - $have, $have);
        if ($n === -2) {
            clearstatcache(true, $p['part']);
            mn_fail(409, 'offset', ['size' => (int)@filesize($p['part'])]);
        }
        if ($n < 0) {
            mn_remove($id);
            mn_fail(413, 'too_large', ['max_bytes' => mn_max_bytes()]);
        }
        clearstatcache(true, $p['part']);
        $size = filesize($p['part']);
        $done = $size === $total;
        if ($done) {
            @rename($p['part'], $p['bin']);
            $m['done'] = true;
            mn_write_meta($p['meta'], $m);
        }
        mn_json(200, ['id' => $id, 'size' => $size, 'done' => $done]);
    }

    // nové sdílení
    $days = mn_int_param('days');
    $total = mn_int_param('total');
    if ($days === null || $days < 1 || $days > MN_MAX_DAYS) mn_fail(400, 'invalid_days', ['max_days' => MN_MAX_DAYS]);
    if ($total === null || $total < 1) mn_fail(400, 'invalid_total');
    if ($total > mn_max_bytes()) mn_fail(413, 'too_large', ['max_bytes' => mn_max_bytes()]);
    if ($len > $total) mn_fail(413, 'too_large', ['max_bytes' => mn_max_bytes()]);
    $d = mn_data_dir();
    $usage = (int)@file_get_contents("$d/.usage");
    if ($usage + $total > mn_quota()) {
        mn_gc(true);
        $usage = (int)@file_get_contents("$d/.usage");
        if ($usage + $total > mn_quota()) mn_fail(507, 'storage_full');
    }
    if (($retry = mn_rate(max(0, $len), true)) !== null) mn_fail(429, 'rate_limited', [], ['Retry-After: ' . $retry]);
    do {
        $id = mn_rand62(MN_ID_LEN);
        $p = mn_paths($id);
    } while (file_exists($p['meta']));
    $tok = mn_rand62(24);
    $now = time();
    $m = ['v' => 1, 'exp' => $now + $days * 86400, 'del' => hash('sha256', $tok), 'total' => $total, 'created' => $now, 'done' => false];
    if (!mn_write_meta($p['meta'], $m)) mn_fail(503, 'storage_unavailable');
    $n = mn_store_body($p['part'], $total, 0);
    if ($n < 0) {
        mn_remove($id);
        mn_fail(413, 'too_large', ['max_bytes' => mn_max_bytes()]);
    }
    if ($n === 0) {
        mn_remove($id);
        mn_fail(400, 'empty_body');
    }
    clearstatcache(true, $p['part']);
    $size = filesize($p['part']);
    $done = $size === $total;
    if ($done) {
        @rename($p['part'], $p['bin']);
        $m['done'] = true;
        mn_write_meta($p['meta'], $m);
    }
    @file_put_contents("$d/.usage", (string)($usage + $total), LOCK_EX);
    mn_json(201, ['id' => $id, 'del' => $tok, 'exp' => $m['exp'], 'size' => $size, 'done' => $done]);
}

if ($method === 'DELETE') {
    if (!mn_same_origin()) mn_fail(403, 'cross_origin');
    $id = mn_str_param('id');
    if (!mn_valid_id($id)) mn_fail(400, 'invalid_id');
    $tok = mn_token();
    $p = mn_paths($id);
    $m = mn_read_meta($p['meta']);
    if (!$m) mn_fail(404, 'not_found');
    if ($tok === '' || !hash_equals((string)$m['del'], hash('sha256', $tok))) mn_fail(403, 'bad_token');
    mn_remove($id);
    mn_json(200, ['ok' => true]);
}

mn_fail(405, 'method_not_allowed', [], $allow);
