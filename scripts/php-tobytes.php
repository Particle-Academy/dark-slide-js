<?php

declare(strict_types=1);

/**
 * Cross-engine parity helper: emit pptx bytes from the PHP dark-slide for a
 * given JSON deck, so the TS port can be diffed against it. Uses a minimal
 * PSR-4 autoloader (the PHP core is zero-dependency) — no composer needed.
 *
 *   php php-tobytes.php <deck.json> <out.pptx> [options.json]
 *
 * `options.json` is passed straight through as the PHP writer's options. Its
 * `fonts` map names FILE PATHS (`typeface => variant => path`), which the PHP
 * engine accepts; the TS side of a parity case reads the same files as bytes.
 */

spl_autoload_register(function (string $class): void {
    $prefix = 'DarkSlide\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $rel = substr($class, strlen($prefix));
    // Outside the .agi envelope the PHP package is not a sibling directory, so CI
    // (and any other layout) points at it with DARK_SLIDE_PHP_SRC.
    $root = getenv('DARK_SLIDE_PHP_SRC') ?: __DIR__ . '/../../dark-slide/src';
    $file = rtrim($root, '/') . '/' . str_replace('\\', '/', $rel) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$deckJson = file_get_contents($argv[1]);
$deck = json_decode($deckJson, true);
$options = isset($argv[3]) ? json_decode(file_get_contents($argv[3]), true) : [];
$bytes = \DarkSlide\Agent::toBytes($deck, is_array($options) ? $options : []);
file_put_contents($argv[2], $bytes);
