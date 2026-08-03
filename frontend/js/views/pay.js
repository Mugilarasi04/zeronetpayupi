import { rupeesPlain, toast, uuid, copyText, escapeHtml } from '../util.js';
import { store } from '../store.js';
import { chunkPayload, renderToCanvas, encodePayloadAsText } from '../qr.js';
import { authenticate as bioAuth } from '../biometric.js';
import { api } from '../api.js';

export function renderPay(root, state, { refresh, navigate }) {
  const total = state.tokens.reduce((s, t) => s + t.value_paise, 0);
  if (state.tokens.length === 0) {
    root.innerHTML = `
      <div class="card">
        <h3>No tokens yet</h3>
        <p class="muted">Load money first so you have signed tokens to spend.</p>
        <button id="go" class="btn">Load Money</button>
      </div>
    `;
    root.querySelector('#go').addEventListener('click', () => navigate('load'));
    return;
  }

  root.innerHTML = `
    <section class="card">
      <h3>Send offline payment</h3>
      <p class="muted">Wallet: <strong>${rupeesPlain(total)}</strong> · ${state.tokens.length} tokens</p>
      <label for="amt">Amount (₹)</label>
      <input id="amt" type="number" min="1" step="1" placeholder="10" inputmode="numeric" />
      <div style="height: 10px"></div>
      <button id="auth" class="btn">Authenticate &amp; generate QR</button>
      <small class="muted" style="display:block; margin-top: 8px;">Each payment requires PIN / fingerprint. Tokens stay in your wallet until you tap <strong>Sent ✓</strong> after the receiver scans.</small>
    </section>

    <div id="qrCard" class="card" hidden>
      <h3>Have the receiver scan this</h3>
      <p class="muted" id="qrNote"></p>
      <div class="qr-wrap"><canvas id="qrCanvas"></canvas></div>
      <div style="height: 10px"></div>
      <div id="qrSteps" class="muted" style="text-align:center; font-size: 12px;"></div>

      <div class="divider" style="margin: 14px 0;"></div>

      <div class="card tight" style="background: var(--card-hi); border-color: rgba(59,130,246,0.4);">
        <p style="margin: 0 0 8px 0;"><strong>🔢 Pairing code (easiest fallback)</strong></p>
        <p class="muted" style="margin: 0 0 8px 0; font-size: 12px;">
          Tell the receiver these <strong>6 digits</strong>. They enter them
          in the Receive tab and get paid instantly. Code expires in 5 min.
        </p>
        <div id="pairCodeBox" style="text-align:center; padding: 14px 0;">
          <div id="pairCode" style="font-weight:900; font-size: 36px; letter-spacing: 10px; color:#86efac; font-family: ui-monospace, monospace;">— — — — — —</div>
          <small class="muted" id="pairCodeStatus" style="font-size: 11px;">generating…</small>
        </div>
        <button class="btn ghost btn-sm" id="shareCode" style="width:100%;">💬 Share code via WhatsApp / SMS</button>
      </div>

      <div class="divider" style="margin: 14px 0;"></div>

      <details style="font-size: 13px;">
        <summary class="muted" style="cursor: pointer;">Advanced: full text transfer code</summary>
        <div style="margin-top: 8px;">
          <p class="muted" style="font-size: 11px; margin: 0 0 6px 0;">
            Check code:
            <span id="checkCode" style="font-weight:800; font-size: 18px; letter-spacing: 4px; color:#86efac;">----</span>
          </p>
          <button class="btn ghost btn-sm" id="copyCode">📋 Copy full transfer code</button>
        </div>
      </details>

      <div style="height: 12px"></div>
      <div class="row">
        <button class="btn success" id="confirmSent">Sent ✓ (remove from wallet)</button>
        <button class="btn ghost" id="back">Cancel</button>
      </div>
      <small class="muted" style="display: block; margin-top: 10px;">
        Tap <strong>Sent ✓</strong> only after the receiver's screen confirms tokens were received.
        Until then, tokens remain in your wallet so you don't lose them if the scan fails.
      </small>
    </div>
  `;

  const amt = root.querySelector('#amt');
  const auth = root.querySelector('#auth');
  const qrCard = root.querySelector('#qrCard');
  const qrCanvas = root.querySelector('#qrCanvas');
  const qrNote = root.querySelector('#qrNote');
  const qrSteps = root.querySelector('#qrSteps');
  const confirmSent = root.querySelector('#confirmSent');
  const back = root.querySelector('#back');
  amt.focus();

  let activeFrames = [];
  let frameTimer = null;
  let pickedTokens = [];
  let amountValue = 0;

  async function authenticate() {
    return bioAuth({ userId: state.user.id, upiId: state.user.upiId });
  }

  function stopQR() {
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }

  auth.addEventListener('click', async () => {
    const value = parseInt(amt.value, 10);
    if (!value || value <= 0 || !Number.isInteger(value)) {
      toast('Enter a positive whole number of rupees', 'bad');
      return;
    }
    if (value * 100 > total) {
      toast('Insufficient offline balance', 'bad');
      return;
    }

    auth.disabled = true;
    auth.innerHTML = '<span class="spinner"></span> Authenticating…';
    const ok = await authenticate();
    if (!ok) {
      toast('Authentication cancelled', 'bad');
      auth.disabled = false;
      auth.textContent = 'Authenticate & generate QR';
      return;
    }

    // Pick tokens (FIFO) summing to exact target. Tokens are NOT removed
    // from the wallet here — only on explicit "Sent ✓" confirmation.
    const targetPaise = value * 100;
    const sorted = [...state.tokens].sort((a, b) => a.issued_at - b.issued_at);
    const picked = [];
    let acc = 0;
    for (const t of sorted) {
      if (acc >= targetPaise) break;
      picked.push(t);
      acc += t.value_paise;
    }
    if (acc !== targetPaise) {
      toast('Cannot make exact change for that amount with current tokens', 'bad');
      auth.disabled = false;
      auth.textContent = 'Authenticate & generate QR';
      return;
    }
    pickedTokens = picked;
    amountValue = value;

    const payload = {
      from: { upiId: state.user.upiId, deviceId: state.user.deviceId },
      tokens: picked.map((t) => ({
        id: t.id,
        value_paise: t.value_paise,
        issued_to_user_id: t.issued_to_user_id,
        issued_to_device: t.issued_to_device,
        issued_at: t.issued_at,
        expires_at: t.expires_at,
        signature: t.signature,
      })),
      ts: Date.now(),
    };

    activeFrames = chunkPayload(payload);
    qrNote.textContent = `${picked.length} tokens · ${rupeesPlain(value * 100)}`;
    qrCard.hidden = false;
    auth.disabled = false;
    auth.style.display = 'none';
    amt.disabled = true;

    // Build the text-code fallback and wire up copy/share.
    const encoded = encodePayloadAsText(payload);
    const checkCodeEl = root.querySelector('#checkCode');
    if (checkCodeEl) checkCodeEl.textContent = encoded.code;
    const copyBtn = root.querySelector('#copyCode');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(encoded.text);
        toast(ok ? `Copied — code ${encoded.code}` : 'Copy failed', ok ? 'good' : 'bad');
      });
    }

    // 6-digit pairing code — post payload to the rendezvous service so
    // the receiver only needs to type 6 digits. Requires internet on the
    // sender side (which they had 10 seconds ago when they authenticated
    // — this happens as a background call).
    const pairCodeEl = root.querySelector('#pairCode');
    const pairStatusEl = root.querySelector('#pairCodeStatus');
    const shareBtn = root.querySelector('#shareCode');
    let pairCode = null;
    (async () => {
      try {
        const r = await api.createPairCode(payload);
        pairCode = r.code;
        pairCodeEl.textContent = pairCode.split('').join(' ');
        pairStatusEl.textContent = `expires in 5 min — receiver types this in the Receive tab`;
      } catch (e) {
        pairCodeEl.textContent = '(unavailable)';
        pairStatusEl.textContent = 'Pair-code service offline — use the QR or full text code below';
        pairStatusEl.style.color = '#fca5a5';
      }
    })();

    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const codeMsg = pairCode
          ? `ZeroNetPay pair code: ${pairCode}\n\nEnter this in your Receive tab to import ₹${value}.\n(Valid 5 min.)`
          : `ZeroNetPay transfer — code ${encoded.code}\n\nPaste the full code in Receive tab:\n\n${encoded.text}`;
        if (navigator.share) {
          try {
            await navigator.share({ title: 'ZeroNetPay transfer', text: codeMsg });
            return;
          } catch (_) { /* fall through */ }
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(codeMsg)}`, '_blank');
      });
    }

    if (activeFrames.length === 1) {
      qrSteps.textContent = 'Hold steady — single frame';
      await renderToCanvas(qrCanvas, JSON.stringify(activeFrames[0]));
    } else {
      // Hold each frame for 1.6s so the receiver's camera has ample time to
      // lock-on, decode, and dedupe before the next frame appears.
      let i = 0;
      const tick = async () => {
        const f = activeFrames[i % activeFrames.length];
        qrSteps.innerHTML =
          `<strong>Frame ${(i % activeFrames.length) + 1} of ${activeFrames.length}</strong> ` +
          `— keep showing until receiver says "✔ Payment received"`;
        await renderToCanvas(qrCanvas, JSON.stringify(f));
        i++;
      };
      await tick();
      frameTimer = setInterval(tick, 1600);
    }
  });

  confirmSent.addEventListener('click', async () => {
    if (!pickedTokens.length) return;
    confirmSent.disabled = true;
    stopQR();
    await store.removeTokens(pickedTokens.map((t) => t.id));
    await store.addLedger({
      id: uuid(),
      ts: Date.now(),
      kind: 'send',
      amount: amountValue,
      note: `Offline payment · ${pickedTokens.length} tokens`,
    });
    pickedTokens = [];
    toast('Sent — tokens removed from wallet', 'good');
    await refresh();
    navigate('home');
  });

  back.addEventListener('click', async () => {
    stopQR();
    pickedTokens = [];
    toast('Cancelled — tokens still in your wallet', 'good');
    navigate('home');
  });
}
