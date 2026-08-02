#!/usr/bin/env node
/**
 * Copies browser-side vendor libraries from node_modules into frontend/vendor
 * so the PWA can serve them locally and work offline (cached by service worker).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'frontend', 'vendor');

const ASSETS = [
  {
    from: path.join(ROOT, 'node_modules', 'qrcode-generator', 'qrcode.js'),
    to: path.join(DEST, 'qrcode-generator.js'),
  },
  {
    from: path.join(ROOT, 'node_modules', 'jsqr', 'dist', 'jsQR.js'),
    to: path.join(DEST, 'jsQR.js'),
  },
];

fs.mkdirSync(DEST, { recursive: true });

let okCount = 0;
for (const { from, to } of ASSETS) {
  try {
    if (!fs.existsSync(from)) {
      console.warn(`[setup-vendor] missing: ${from}`);
      continue;
    }
    fs.copyFileSync(from, to);
    okCount++;
    console.log(`[setup-vendor] copied ${path.basename(to)}`);
  } catch (err) {
    console.warn(`[setup-vendor] failed for ${from}: ${err.message}`);
  }
}

console.log(`[setup-vendor] ${okCount}/${ASSETS.length} vendor assets ready in ${DEST}`);
