#!/usr/bin/env node
/**
 * Generate app icons from favicon.svg
 * Outputs: build/icon.ico (Windows), build/icon.icns (Mac), build/icon.png (256px)
 */
const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

const SVG = path.join(__dirname, '../renderer/public/favicon.svg');
const BUILD = path.join(__dirname, '../build');

async function main() {
  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true });

  const svgBuffer = fs.readFileSync(SVG);

  // Generate PNGs at various sizes
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngBuffers = {};

  for (const size of sizes) {
    const buf = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers[size] = buf;
    fs.writeFileSync(path.join(BUILD, `icon-${size}.png`), buf);
  }

  // Main icon.png (256px for electron-builder)
  fs.writeFileSync(path.join(BUILD, 'icon.png'), pngBuffers[256]);
  console.log('icon.png (256px)');

  // Windows .ico (contains 16, 32, 48, 256)
  const icoInputs = [16, 32, 48, 256].map(s => pngBuffers[s]);
  const icoBuffer = await toIco(icoInputs);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), icoBuffer);
  console.log('icon.ico');

  // For Mac, electron-builder uses icon.png (1024px) to generate .icns
  fs.writeFileSync(path.join(BUILD, 'icon-1024.png'), pngBuffers[1024]);
  console.log('icon-1024.png (for macOS icns generation)');

  console.log('All icons generated in build/');
}

main().catch(err => { console.error(err); process.exit(1); });
