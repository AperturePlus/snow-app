#!/usr/bin/env node
/**
 * macOS IME noise filter for Electron dev output.
 *
 * macOS Chromium layer emits harmless TSM/IMK messages on every keystroke:
 *   - TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit
 *   - error messaging the mach port for IMKCFRunLoopWakeUpReliable
 *
 * These bypass Node.js process.stderr (written directly to fd 2 by native
 * frameworks), so we filter at the pipe level instead.
 *
 * Usage:  electron-vite dev 2>&1 | node scripts/filter-ime-noise.cjs
 */
'use strict';

const readline = require('readline');

const NOISE_PATTERNS = [
  'TSM AdjustCapsLockLEDForKeyTransitionHandling',
  '_ISSetPhysicalKeyboardCapsLockLED Inhibit',
  'error messaging the mach port for IMKCFRunLoopWakeUpReliable'
];

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on('line', (line) => {
  if (NOISE_PATTERNS.some((p) => line.includes(p))) return;
  process.stdout.write(line + '\n');
});

rl.on('close', () => {
  process.exit(0);
});
