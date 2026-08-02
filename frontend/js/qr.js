// QR generation and scanning helpers.
//
// Generation: uses the qrcode.min.js vendor library which exposes a
// global `QRCode` (the node "qrcode" package, browser build).
// Scanning:   uses jsQR which exposes a global `jsQR`.
//
// Large payloads are split across multiple QR frames using a tiny
// envelope: { v, c, total, idx, sid, data }. The receiver reassembles
// once it has seen all `total` frames sharing the same `sid`.

const FRAME_VERSION = 1;
const FRAME_KIND = 'znp.tx';
// Keep each frame small enough that the QR has chunky, easy-to-read modules.
// 350 bytes ≈ QR version ~13 with EC 'M' — easily decoded by a phone camera
// even when the receiver is moving slightly.
const MAX_BYTES_PER_FRAME = 350;

export function chunkPayload(payload) {
  const json = JSON.stringify(payload);
  const sid =
    'S' +
    Math.random().toString(36).slice(2, 8) +
    Date.now().toString(36).slice(-4);
  const chunks = [];
  for (let i = 0; i < json.length; i += MAX_BYTES_PER_FRAME) {
    chunks.push(json.slice(i, i + MAX_BYTES_PER_FRAME));
  }
  return chunks.map((data, idx) => ({
    v: FRAME_VERSION,
    k: FRAME_KIND,
    sid,
    total: chunks.length,
    idx,
    data,
  }));
}

export function tryReassemble(frames) {
  if (!frames.length) return null;
  const first = frames[0];
  if (frames.length < first.total) return null;
  const ordered = new Array(first.total);
  for (const f of frames) {
    if (f.sid !== first.sid) return null;
    ordered[f.idx] = f.data;
  }
  if (ordered.some((x) => x === undefined)) return null;
  try {
    return JSON.parse(ordered.join(''));
  } catch (_) {
    return null;
  }
}

export function parseFrame(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.k === FRAME_KIND && obj.v === FRAME_VERSION) return obj;
  } catch (_) {
    /* ignore */
  }
  return null;
}

// Render to a canvas element. Uses qrcode-generator's qrcode(typeNumber, ec)
// global which auto-fits the lowest type for the given payload.
export async function renderToCanvas(canvas, text) {
  // qrcode-generator exposes a global function `qrcode(typeNumber, ec)`.
  if (typeof qrcode !== 'function') throw new Error('QR library not loaded yet');
  // typeNumber 0 = auto-detect smallest fitting type
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  // Bigger modules → easier camera lock-on. 10px per module makes the QR
  // visibly chunky and decodes reliably even from a foot away.
  const cellSize = 10;
  const margin = cellSize * 3; // generous quiet zone for camera tolerance
  const size = moduleCount * cellSize + margin * 2;

  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
      }
    }
  }
}

/**
 * Start a camera preview into the given <video> element. Returns a
 * function to stop the camera. Calls onScan(text) once per decoded QR.
 */
export async function startScanner(videoEl, canvasEl, onScan) {
  if (typeof jsQR !== 'function') {
    throw new Error('QR scanner library not loaded yet');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('camera not available');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;
  await videoEl.play();

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let lastText = '';
  let lastTextTs = 0;

  function tick() {
    if (stopped) return;
    if (videoEl.readyState !== videoEl.HAVE_ENOUGH_DATA) {
      return requestAnimationFrame(tick);
    }
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    canvasEl.width = w;
    canvasEl.height = h;
    ctx.drawImage(videoEl, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    // attemptBoth = robust under varying lighting; the small extra CPU
    // cost is fine on modern phones and dramatically improves reliability.
    const code = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) {
      const now = Date.now();
      // Debounce IDENTICAL text within 350ms so we still capture distinct
      // frames in a multi-frame cycle (sender holds each frame for ~1.2 s).
      if (code.data !== lastText || now - lastTextTs > 350) {
        lastText = code.data;
        lastTextTs = now;
        try {
          onScan(code.data);
        } catch (e) {
          console.error(e);
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return () => {
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    if (videoEl.srcObject) videoEl.srcObject = null;
  };
}
