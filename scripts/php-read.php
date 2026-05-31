<?php

declare(strict_types=1);

/**
 * Cross-engine READER parity helper: read a .pptx file with the PHP
 * dark-slide reader and emit the resulting deck schema as JSON, so the TS
 * port's reader can be diffed against it. Uses the same minimal PSR-4
 * autoloader as php-tobytes.php (the PHP core is zero-dependency) — no
 * composer needed.
 *
 *   php php-read.php <in.pptx>
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

$path = $argv[1];
$result = \DarkSlide\Agent::read($path);
echo json_encode($result, JSON_PRETTY_PRINT);
