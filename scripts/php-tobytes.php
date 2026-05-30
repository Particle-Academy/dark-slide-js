<?php

declare(strict_types=1);

/**
 * Cross-engine parity helper: emit pptx bytes from the PHP dark-slide for a
 * given JSON deck, so the TS port can be diffed against it. Uses a minimal
 * PSR-4 autoloader (the PHP core is zero-dependency) — no composer needed.
 *
 *   php php-tobytes.php <deck.json> <out.pptx>
 */

spl_autoload_register(function (string $class): void {
    $prefix = 'DarkSlide\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $rel = substr($class, strlen($prefix));
    $file = __DIR__ . '/../../dark-slide/src/' . str_replace('\\', '/', $rel) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$deckJson = file_get_contents($argv[1]);
$deck = json_decode($deckJson, true);
$bytes = \DarkSlide\Agent::toBytes($deck);
file_put_contents($argv[2], $bytes);
