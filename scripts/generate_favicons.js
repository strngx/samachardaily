const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// CRC32 implementation for PNG chunks
function createCRC32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}
const crcTable = createCRC32Table();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

function createPngBuffer(width, height, renderPixel) {
  // Signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth: 8
  ihdr[9] = 6; // color type: 6 (RGBA)
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard
  ihdr[12] = 0; // interlace: none
  const ihdrChunk = makeChunk('IHDR', ihdr);
  
  // Scanlines with filter byte 0
  const rowBytes = width * 4;
  const rawData = Buffer.alloc((rowBytes + 1) * height);
  
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowBytes + 1);
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = renderPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }
  
  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Multi-size icon renderer
// Color palette: Crimson Red #C81E2C (RGB: 200, 30, 44), White #FFFFFF (255, 255, 255)
function renderBrandIcon(x, y, w, h, isTiny) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = (w / 2) - (w > 32 ? 1 : 0.5);
  
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Anti-aliased circle edge
  let circleAlpha = 0;
  if (dist <= radius - 0.5) circleAlpha = 255;
  else if (dist < radius + 0.5) circleAlpha = Math.round(255 * (radius + 0.5 - dist));
  else return [0, 0, 0, 0]; // Outside circle (transparent)
  
  const red = 200;
  const green = 30;
  const blue = 44;
  
  // Render letter "S" inside the circle
  const nx = (x + 0.5) / w;
  const ny = (y + 0.5) / h;
  
  let isLetter = false;
  
  if (w <= 48) {
    // Bold geometric "S" for crisp 16x16, 32x32, 48x48 rendering
    // Bounds: X [0.28, 0.72], Y [0.22, 0.78]
    const sx = (nx - 0.28) / 0.44; // 0 to 1
    const sy = (ny - 0.22) / 0.56; // 0 to 1
    
    if (sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1) {
      const barThick = 0.22;
      const topBar = sy <= barThick;
      const midBar = sy >= 0.5 - (barThick / 2) && sy <= 0.5 + (barThick / 2);
      const botBar = sy >= 1.0 - barThick;
      const leftUpper = sx <= barThick && sy <= 0.5;
      const rightLower = sx >= 1.0 - barThick && sy >= 0.5;
      
      if (topBar || midBar || botBar || leftUpper || rightLower) {
        isLetter = true;
      }
    }
  } else {
    // High-resolution icon (180, 192, 512): Detailed bold condensed brand lettering SAMACHAR / DAILY
    // Top line: SAMACHAR
    // Bottom line: DAILY
    // Geometric high-DPI rendering for "SD" / "SAMACHAR DAILY"
    const sx = (nx - 0.22) / 0.56;
    const sy = (ny - 0.22) / 0.56;
    
    if (sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1) {
      const barThick = 0.18;
      const topBar = sy <= barThick;
      const midBar = sy >= 0.5 - (barThick / 2) && sy <= 0.5 + (barThick / 2);
      const botBar = sy >= 1.0 - barThick;
      const leftUpper = sx <= barThick && sy <= 0.5;
      const rightLower = sx >= 1.0 - barThick && sy >= 0.5;
      
      if (topBar || midBar || botBar || leftUpper || rightLower) {
        isLetter = true;
      }
    }
  }
  
  if (isLetter) {
    return [255, 255, 255, circleAlpha]; // White letter
  } else {
    return [red, green, blue, circleAlpha]; // Brand red background
  }
}

// Build standard ICO file containing multiple PNG images (16x16, 32x32, 48x48)
function createIcoFile(pngBuffers) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(count, 4); // Number of images
  
  let offset = 6 + count * 16;
  const dirEntries = [];
  
  for (const item of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = item.width >= 256 ? 0 : item.width;
    entry[1] = item.height >= 256 ? 0 : item.height;
    entry[2] = 0; // Color count
    entry[3] = 0; // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(item.buffer.length, 8); // Size of image data
    entry.writeUInt32LE(offset, 12); // Offset of image data
    
    dirEntries.push(entry);
    offset += item.buffer.length;
  }
  
  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map(p => p.buffer)]);
}

// Generate all required files
console.log('Generating production brand icons...');

const png16 = createPngBuffer(16, 16, (x, y, w, h) => renderBrandIcon(x, y, w, h, true));
const png32 = createPngBuffer(32, 32, (x, y, w, h) => renderBrandIcon(x, y, w, h, true));
const png48 = createPngBuffer(48, 48, (x, y, w, h) => renderBrandIcon(x, y, w, h, true));
const png180 = createPngBuffer(180, 180, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
const png192 = createPngBuffer(192, 192, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
const png512 = createPngBuffer(512, 512, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));

const icoBuffer = createIcoFile([
  { width: 16, height: 16, buffer: png16 },
  { width: 32, height: 32, buffer: png32 },
  { width: 48, height: 48, buffer: png48 }
]);

// Write target assets to src/ and src/assets/images/
const targets = [
  { path: 'src/favicon.ico', buf: icoBuffer },
  { path: 'src/apple-touch-icon.png', buf: png180 },
  { path: 'src/assets/images/favicon-16x16.png', buf: png16 },
  { path: 'src/assets/images/favicon-32x32.png', buf: png32 },
  { path: 'src/assets/images/favicon-48x48.png', buf: png48 },
  { path: 'src/assets/images/apple-touch-icon.png', buf: png180 },
  { path: 'src/assets/images/icon-192.png', buf: png192 },
  { path: 'src/assets/images/icon-512.png', buf: png512 }
];

targets.forEach(t => {
  fs.writeFileSync(t.path, t.buf);
  console.log(`Created: ${t.path} (${t.buf.length} bytes)`);
});

// Update SVG favicon to match circular brandmark with crisp red circle and white S
const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="31" fill="#C81E2C" />
  <path d="M 22 21 H 42 V 29 H 28 V 33 H 42 V 43 H 22 V 35 H 36 V 32 H 22 Z" fill="#FFFFFF" />
</svg>`;
fs.writeFileSync('src/assets/images/favicon.svg', svgFavicon);
console.log('Updated: src/assets/images/favicon.svg');

// Create site.webmanifest
const webmanifest = {
  name: "SamacharDaily",
  short_name: "SamacharDaily",
  description: "News, Fast. Trends, Explained.",
  start_url: "/",
  display: "standalone",
  background_color: "#FFFFFF",
  theme_color: "#C81E2C",
  icons: [
    {
      src: "/assets/images/icon-192.png",
      sizes: "192x192",
      type: "image/png"
    },
    {
      src: "/assets/images/icon-512.png",
      sizes: "512x512",
      type: "image/png"
    }
  ]
};

fs.writeFileSync('src/site.webmanifest', JSON.stringify(webmanifest, null, 2));
console.log('Created: src/site.webmanifest');
