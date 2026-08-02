import { rupeesPlain, toast, uuid, isOnline } from '../util.js';
import { store } from '../store.js';
import { startScanner, parseFrame, tryReassemble } from '../qr.js';

export function renderReceive(root, state, { refresh, trySyncPending }) {
  root.innerHTML = `
    <section class="card">
      <h3>Receive offline payment</h3>
      <p class="muted">Point your camera at the sender's QR code. Multi-frame transfers are reassembled automatically.</p>
      <div class="scan-wrap">
        <video id="cam" playsinline></video>
        <div class="reticle"></div>
      </div>
      <canvas id="scanCanvas" hidden></canvas>
      <div id="progress" class="muted" style="text-align:center; margin-top: 10px;">Initialising camera…</div>
      <div style="height: 12px"></div>
      <button id="stop" class="btn ghost">Stop scanner</button>
    </section>

    <div id="result" hidden></div>
  `;

  const video = root.querySelector('#cam');
  const canvas = root.querySelector('#scanCanvas');
  const progress = root.querySelector('#progress');
  const stop = root.querySelector('#stop');
  const result = root.querySelector('#result');

  let stopFn = null;
  let collected = new Map(); // sid -> Map<idx, frame>
  let lastSid = null;

  async function handleScan(text) {
    const frame = parseFrame(text);
    if (!frame) {
      progress.textContent = "Saw a QR but it isn't a ZeroNetPay payment.";
      return;
    }
    if (frame.sid !== lastSid) {
      collected = new Map();
      lastSid = frame.sid;
    }
    let bag = collected.get(frame.sid);
    if (!bag) {
      bag = new Map();
      collected.set(frame.sid, bag);
    }
    bag.set(frame.idx, frame);

    // Show captured/missing frames as little chips so you can SEE progress
    // even when the sender cycles past the same frames a few times.
    const chips = [];
    for (let i = 0; i < frame.total; i++) {
      if (bag.has(i)) {
        chips.push(`<span style="display:inline-block; padding:2px 6px; margin:1px; background:#22c55e; color:#0b1220; border-radius:4px; font-size:11px; font-weight:700;">${i + 1}</span>`);
      } else {
        chips.push(`<span style="display:inline-block; padding:2px 6px; margin:1px; background:#374151; color:#94a3b8; border-radius:4px; font-size:11px;">${i + 1}</span>`);
      }
    }
    progress.innerHTML =
      `Captured <strong>${bag.size} / ${frame.total}</strong> frames<br/>` +
      `<div style="margin-top: 4px;">${chips.join('')}</div>` +
      (bag.size < frame.total
        ? '<small class="muted" style="display:block; margin-top: 4px;">Keep the camera on the sender\'s QR — missing frames will fill in as the sender cycles through.</small>'
        : '');

    if (bag.size >= frame.total) {
      const payload = tryReassemble([...bag.values()]);
      if (!payload) {
        progress.textContent = 'Frames captured but payload is corrupt — ask sender to retry.';
        return;
      }
      await acceptPayment(payload);
    }
  }

  async function acceptPayment(payload) {
    if (stopFn) stopFn();
    stopFn = null;

    const total = payload.tokens.reduce((s, t) => s + t.value_paise, 0);
    const senderUpi = (payload.from && payload.from.upiId) || 'unknown';

    // Local ledger entry for the immediate receipt
    await store.addLedger({
      id: uuid(),
      ts: Date.now(),
      kind: 'receive',
      amount: total / 100,
      note: 'From ' + senderUpi,
    });

    // Cascade-friendly: drop the received tokens directly into the wallet
    // so they are spendable for further offline payments. The user explicitly
    // chooses when to convert to bank money via the Cash out tab.
    // We tag each token with its provenance for the audit trail.
    const tagged = payload.tokens.map((t) => ({
      ...t,
      received_from_upi: senderUpi,
      received_from_device: payload.from && payload.from.deviceId,
      received_at: Date.now(),
    }));
    await store.addTokens(tagged);

    result.hidden = false;
    result.innerHTML = `
      <div class="card" style="border-color: rgba(34,197,94,0.4);">
        <h3 style="color: #86efac;">✔ Payment received</h3>
        <p style="font-size: 28px; font-weight: 700; margin: 8px 0;">${rupeesPlain(total)}</p>
        <p class="muted">From <strong>${senderUpi}</strong> · ${payload.tokens.length} tokens</p>
        <p class="muted">Tokens are now in your wallet. You can re-spend them offline, or
          tap <strong>Cash out</strong> to convert them to money in your bank when you're online.</p>
        <div style="height: 8px"></div>
        <button id="more" class="btn ghost">Receive another</button>
      </div>
    `;
    result.querySelector('#more').addEventListener('click', () => {
      result.hidden = true;
      result.innerHTML = '';
      collected = new Map();
      lastSid = null;
      progress.textContent = 'Initialising camera…';
      startCam();
    });

    await refresh();
    // Try to settle immediately if we have internet.
    if (isOnline()) trySyncPending();
  }

  async function startCam() {
    try {
      stopFn = await startScanner(video, canvas, handleScan);
      progress.textContent = 'Camera ready — show me the sender\'s QR';
    } catch (e) {
      progress.innerHTML =
        'Camera blocked or not available.<br/><small class="muted">' + e.message + '</small>';
    }
  }

  stop.addEventListener('click', () => {
    if (stopFn) stopFn();
    stopFn = null;
    progress.textContent = 'Scanner stopped.';
  });

  startCam();

  // Cleanup when this view is replaced.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(video)) {
      if (stopFn) stopFn();
      stopFn = null;
      observer.disconnect();
    }
  });
  observer.observe(root.parentElement, { childList: true, subtree: true });
}
