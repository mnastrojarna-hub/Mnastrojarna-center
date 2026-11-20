<?php
/**
 * Mnástrojárna CAD – úložiště krátkých sdílených odkazů: ZAVADĚČ.
 *
 * Vlastní logika je ve store.php vedle. Tento soubor záměrně používá jen syntaxi a funkce, které má i velmi staré PHP,
 * aby na KAŽDÉM hostingu odpověděl čitelně, místo prázdné chyby 500:
 *   – staré PHP (< 5.6)               → 500 {"ok":false,"error":"php_too_old","php":"…","need":"5.6"}
 *   – zakázané nezbytné funkce        → 500 {"ok":false,"error":"php_functions_disabled","missing":[…]}
 *   – jakákoli fatální chyba PHP       → 500 {"ok":false,"error":"php_fatal","php":"…","detail":"…"} (bez cest na serveru)
 * Klient v CADu text chyby ukáže uživateli; správce ho uvidí i na adrese …/cad/share/?ping a …/cad/share/?diag.
 */
define('MN_SHARE_BOOT', 1);
if (function_exists('ini_set')) {
    @ini_set('display_errors', '0');
}

/** JSON bez rozšíření json (i to může chybět) – jen ploché hodnoty a pole řetězců */
function mn_boot_json_value($v)
{
    if (is_array($v)) {
        $out = array();
        foreach ($v as $x) $out[] = mn_boot_json_value($x);
        return '[' . implode(',', $out) . ']';
    }
    if (is_bool($v)) return $v ? 'true' : 'false';
    if (is_int($v)) return (string)$v;
    $s = (string)$v;
    $s = str_replace(array('\\', '"', "\n", "\r", "\t"), array('\\\\', '\\"', '\\n', '\\r', '\\t'), $s);
    return '"' . preg_replace('/[\x00-\x1f]/', '', $s) . '"';
}
function mn_boot_out($status, $data)
{
    if (!headers_sent()) {
        if (function_exists('http_response_code')) http_response_code($status);
        else header('HTTP/1.1 ' . $status . ' Error');
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    $parts = array();
    foreach ($data as $k => $v) $parts[] = '"' . $k . '":' . mn_boot_json_value($v);
    echo '{' . implode(',', $parts) . '}';
}
/** text chyby bez cest na serveru (soubor a řádek jen jménem) */
function mn_boot_detail($e)
{
    $msg = preg_replace('~(?:[A-Za-z]:)?[\\\\/][^\s:\'"]*[\\\\/]~', '', (string)$e['message']);
    $msg = substr($msg, 0, 300);
    return basename((string)$e['file']) . ':' . (int)$e['line'] . ' ' . $msg;
}
function mn_boot_shutdown()
{
    $e = error_get_last();
    if (!$e) return;
    $fatal = array(E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR);
    if (!in_array($e['type'], $fatal, true)) return;
    if (headers_sent()) return; // odpověď už běží (stahování) – nic dalšího nepřidávat
    mn_boot_out(500, array('ok' => false, 'error' => 'php_fatal', 'php' => PHP_VERSION, 'detail' => mn_boot_detail($e)));
}
register_shutdown_function('mn_boot_shutdown');

// store.php běží na PHP 5.6 až 8.x (hosting s PHP 5.6.40 – bez syntaxe a funkcí PHP 7)
if (version_compare(PHP_VERSION, '5.6.0', '<')) {
    mn_boot_out(500, array('ok' => false, 'error' => 'php_too_old', 'php' => PHP_VERSION, 'need' => '5.6'));
    exit;
}

// funkce, bez kterých úložiště nejde provozovat (volitelné má store.php nahrazené)
$mn_need = array('fopen', 'fread', 'fwrite', 'fclose', 'fseek', 'ftell', 'feof', 'file_get_contents', 'file_put_contents',
    'filesize', 'is_file', 'is_dir', 'mkdir', 'rename', 'unlink', 'dirname', 'json_encode', 'json_decode', 'hash',
    'preg_match', 'header', 'http_response_code');
$mn_missing = array();
foreach ($mn_need as $f) {
    if (!function_exists($f)) $mn_missing[] = $f;
}
if ($mn_missing) {
    mn_boot_out(500, array('ok' => false, 'error' => 'php_functions_disabled', 'php' => PHP_VERSION, 'missing' => $mn_missing));
    exit;
}

/** nezachycená výjimka (PHP 5.6: Exception) nebo chyba (PHP 7+: Error, ParseError … – Throwable) → JSON s místem chyby */
function mn_boot_caught($t)
{
    if (headers_sent()) return;
    mn_boot_out(500, array('ok' => false, 'error' => 'php_fatal', 'php' => PHP_VERSION,
        'detail' => mn_boot_detail(array('message' => get_class($t) . ': ' . $t->getMessage(), 'file' => $t->getFile(), 'line' => $t->getLine()))));
}
try {
    require dirname(__FILE__) . '/store.php';
} catch (Throwable $t) { // PHP 7+ (na PHP 5.6 třída neexistuje – blok se jen přeskočí)
    mn_boot_caught($t);
} catch (Exception $e) { // PHP 5.6
    mn_boot_caught($e);
}
