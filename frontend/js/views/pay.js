import { rupeesPlain, toast, uuid, copyText, escapeHtml } from '../util.js';
import { store } from '../store.js';
import { chunkPayload, renderToCanvas, encodePayloadAsText } from '../qr.js';
import { authenticate as bioAuth } from '../biometric.js';

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

      <div class="card tight" style="background: var(--card-hi);">
        <p style="margin: 0 0 6px 0;"><strong>Or share as text (if QR won't scan)</strong></p>
        <p class="muted" style="margin: 0 0 8px 0; font-size: 12px;">
          Check code:
          <span id="checkCode" style="font-weight:800; font-size: 22px; letter-spacing: 4px; color:#86efac;">----</span><br/>
          Sender & receiver see the same 4-digit code — that's how you verify.
        </p>
        <button class="btn" id="copyCode">📋 Copy transfer code</button>
        <button class="btn ghost btn-sm" id="shareCode" style="margin-top: 6px;">💬 Share via WhatsApp / SMS</button>
        <small class="muted" style="display:block; margin-top: 8px;">
          Receiver: paste the copied code in the <strong>Receive</strong> tab's
          "Or paste transfer code" box.
        </small>
      </div>

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
    const shareBtn = root.querySelector('#shareCode');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const msg =
          `ZeroNetPay transfer — code ${encoded.code}%0A%0A` +
          `Paste this into the Receive tab:%0A%0A` +
          encodeURIComponent(encoded.text);
        // Try native share first, fall back to WhatsApp deeplink.
        if (navigator.share) {
          try {
            await navigator.share({
              title: `ZeroNetPay transfer ${encoded.code}`,
              text: `Paste this in Receive tab:\n\n${encoded.text}`,
            });
            return;
          } catch (_) { /* user cancelled or unsupported — fall through */ }
        }
        window.open(`https://wa.me/?text=${msg}`, '_blank');
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
