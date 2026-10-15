import { api } from '../api.js';
import { store } from '../store.js';
import { rupeesPlain, toast, uuid, copyText, isMobile, escapeHtml, whatsappLink } from '../util.js';
import { renderToCanvas } from '../qr.js';

export function renderLoad(root, state, { refresh, navigate }) {
  root.innerHTML = `
    <section class="card">
      <h3>Load money into offline tokens</h3>
      <p class="muted">Pay any amount via UPI to the escrow account. The same amount in cryptographically-signed tokens is minted to your device — those tokens then work offline.</p>
      <label for="amt">Amount (₹)</label>
      <input id="amt" type="number" min="1" step="1" placeholder="100" inputmode="numeric" />
      <div style="height: 10px"></div>
      <button id="go" class="btn">Continue</button>
    </section>

    <div id="step2" hidden></div>
    <div id="step3" hidden></div>
  `;

  const amt = root.querySelector('#amt');
  const go = root.querySelector('#go');
  const step2 = root.querySelector('#step2');
  const step3 = root.querySelector('#step3');

  let order = null;
  amt.focus();

  go.addEventListener('click', async () => {
    const value = parseInt(amt.value, 10);
    if (!value || value <= 0 || !Number.isInteger(value)) {
      toast('Enter a positive whole number of rupees', 'bad');
      return;
    }
    go.disabled = true;
    go.innerHTML = '<span class="spinner"></span> Generating UPI request…';
    try {
      const r = await api.createLoadOrder(state.user.id, value);
      order = r;
      await renderPayStep(step2, step3, r, value);
      step2.hidden = false;
      go.parentElement.style.display = 'none';
    } catch (e) {
      if (e.code === 'offline') {
        toast('Loading needs internet', 'bad');
      } else if (e.message === 'no_escrow') {
        toast('Pick an escrow first — opening the escrow picker', 'warn');
        setTimeout(() => navigate('myescrow'), 800);
      } else if (e.message === 'escrow_not_configured') {
        toast('Configure the escrow UPI ID in Settings first', 'bad');
        setTimeout(() => navigate('settings'), 800);
      } else {
        toast(e.message, 'bad');
      }
      go.disabled = false;
      go.textContent = 'Continue';
    }
  });

  async function renderPayStep(container, doneContainer, ord, value) {
    const mobile = isMobile();
    container.innerHTML = `
      <div class="card">
        <h3>Step 1 · Pay via UPI</h3>
        <div class="card tight" style="background: var(--card-hi); margin-top: 6px;">
          <div class="spaced">
            <div>
              <div class="muted" style="font-size: 12px;">Pay to</div>
              <div style="font-weight: 700; font-size: 16px;" id="payTo">${escapeHtml(ord.escrowUpiId)}</div>
              <div class="muted" style="font-size: 12px;">${escapeHtml(ord.escrowName)}</div>
            </div>
            <button class="btn ghost btn-sm" id="copyUpi">Copy</button>
          </div>
          <div class="divider"></div>
          <div class="spaced">
            <div>
              <div class="muted" style="font-size: 12px;">Amount</div>
              <div style="font-weight: 700; font-size: 22px;">${rupeesPlain(value * 100)}</div>
            </div>
            <button class="btn ghost btn-sm" id="copyAmt">Copy</button>
          </div>
          <div class="divider"></div>
          <div class="spaced">
            <div>
              <div class="muted" style="font-size: 12px;">Reference (note)</div>
              <div style="font-weight: 600;">${escapeHtml(ord.note)}</div>
            </div>
            <button class="btn ghost btn-sm" id="copyNote">Copy</button>
          </div>
        </div>

        <h3 style="margin-top: 16px;">${mobile ? "Tap to pay, or scan the QR with another UPI app" : "Scan this QR with your phone's UPI app"}</h3>
        <div class="qr-wrap"><canvas id="upiQr"></canvas></div>
        <div style="height: 10px"></div>
        ${mobile
          ? `<a id="openApp" href="${escapeHtml(ord.upiLink)}" class="btn" style="text-decoration: none;">Open in UPI app</a>`
          : `<div class="note info">
               You're on a desktop. Open <strong>any UPI app on your phone</strong>
               (GPay, PhonePe, Paytm, WhatsApp Pay, BHIM, ...) and scan this QR — or
               type the UPI ID and amount manually.
             </div>`
        }
        <small class="muted" style="display:block; margin-top: 10px;">
          The QR encodes a standard UPI intent. Any UPI app will recognise it and
          pre-fill the payee, amount, and reference for you.
        </small>

        <div style="height: 16px"></div>
        <div class="card tight" style="background: var(--card-hi); border-color: rgba(59,130,246,0.35);">
          <p style="margin: 0 0 8px 0;"><strong>🔢 Enter the UPI reference number (UTR)</strong></p>
          <p class="muted" style="margin: 0 0 10px 0; font-size: 12px;">
            After your UPI app shows "Payment Successful", you'll get an SMS from your bank
            with a reference number like <code>UPI/P2A/452198765432</code>. Paste the digits
            (the UTR) here. Your escrow friend will check their bank app to confirm they
            actually received the money before your tokens mint.
          </p>
          <label for="utrInput" style="font-size:13px;">UPI reference / UTR</label>
          <input id="utrInput" type="text" inputmode="numeric" placeholder="e.g. 452198765432"
                 autocomplete="off" autocorrect="off" spellcheck="false"
                 style="letter-spacing: 1px;" />
          <small class="muted" id="utrHint" style="display:block; margin-top: 4px;"></small>
          <div style="height: 8px"></div>
          <label for="utrNote" style="font-size:13px;">Optional note (e.g. "paid 2:30pm from HDFC")</label>
          <input id="utrNote" type="text" maxlength="200" placeholder="Something to help your escrow find the credit"
                 autocomplete="off" />
        </div>
        <div style="height: 12px"></div>
        <button id="submitUtr" class="btn success" disabled>Submit for confirmation</button>
        <small class="muted" style="display:block; margin-top: 8px;">
          Your tokens mint only after your escrow (<strong>${escapeHtml(ord.escrowUpiId)}</strong>)
          confirms the money arrived in their bank.
        </small>
      </div>
    `;

    // Render the UPI intent QR (works offline once libs are cached).
    const canvas = container.querySelector('#upiQr');
    try {
      await renderToCanvas(canvas, ord.upiLink);
    } catch (e) {
      console.error(e);
      toast('Could not render QR — copy the UPI ID and amount instead', 'bad');
    }

    container.querySelector('#copyUpi').addEventListener('click', async () => {
      const ok = await copyText(ord.escrowUpiId);
      toast(ok ? 'UPI ID copied' : 'Copy failed', ok ? 'good' : 'bad');
    });
    container.querySelector('#copyAmt').addEventListener('click', async () => {
      const ok = await copyText(value.toFixed(2));
      toast(ok ? 'Amount copied' : 'Copy failed', ok ? 'good' : 'bad');
    });
    container.querySelector('#copyNote').addEventListener('click', async () => {
      const ok = await copyText(ord.note);
      toast(ok ? 'Reference copied' : 'Copy failed', ok ? 'good' : 'bad');
    });

    // --- UTR submit + waiting-for-confirmation flow ---
    const utrInput = container.querySelector('#utrInput');
    const utrNote  = container.querySelector('#utrNote');
    const utrHint  = container.querySelector('#utrHint');
    const submit   = container.querySelector('#submitUtr');

    utrInput.addEventListener('input', () => {
      const v = utrInput.value.trim();
      if (!v) {
        utrHint.textContent = '';
        submit.disabled = true;
        return;
      }
      if (/^[A-Za-z0-9]{6,32}$/.test(v)) {
        utrHint.textContent = '→ looks like a valid UPI reference';
        utrHint.style.color = '#86efac';
        submit.disabled = false;
      } else {
        utrHint.textContent = 'UPI reference is usually 10–22 digits/letters';
        utrHint.style.color = '#fca5a5';
        submit.disabled = true;
      }
    });

    submit.addEventListener('click', async () => {
      const utr = utrInput.value.trim();
      const note = utrNote.value.trim();
      submit.disabled = true;
      submit.innerHTML = '<span class="spinner"></span> Submitting…';
      try {
        const r = await api.submitLoadUtr(ord.orderId, utr, note);
        toast('Submitted — waiting for your escrow to confirm', 'good');
        await renderWaitingStep(doneContainer, ord, r);
        container.hidden = true;
        doneContainer.hidden = false;
      } catch (e) {
        toast(e.message || 'Could not submit UTR', 'bad');
        submit.disabled = false;
        submit.textContent = 'Submit for confirmation';
      }
    });
  }

  // "Waiting for Bob to confirm" screen. Polls /load/status every 4s so the
  // tokens appear in the wallet the moment Bob taps Confirm.
  async function renderWaitingStep(container, ord, submitResp) {
    const issuer = submitResp.issuer; // { id, upiId, phone } or null
    const waMsg =
      `Hi! I just paid ₹${ord.amount} to your UPI (${ord.escrowUpiId}) for a ZeroNetPay load.\n\n` +
      `UPI reference: ${submitResp.utr}\n` +
      `Please check your bank app and tap Confirm in ZeroNetPay so my tokens mint.\n\n` +
      `App: https://upizeronetpay.pages.dev`;
    const wa = issuer && issuer.phone ? whatsappLink(issuer.phone, waMsg) : null;

    container.innerHTML = `
      <div class="card" style="border-color: rgba(251,191,36,0.4);">
        <h3 style="color:#fbbf24;">⏳ Waiting for ${escapeHtml(ord.escrowUpiId)} to confirm</h3>
        <p>You submitted UPI reference <code>${escapeHtml(submitResp.utr)}</code> for ${rupeesPlain(ord.amount * 100)}.</p>
        <p class="muted" style="font-size: 13px;">
          Your tokens will mint the moment your escrow friend checks their bank
          app and taps <strong>Confirm</strong>. You can nudge them on WhatsApp.
        </p>
        <div style="height: 10px"></div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${wa ? `<a class="btn btn-sm" style="background:#25D366; color:white; text-decoration:none;"
                     href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 Nudge ${escapeHtml(issuer.upiId)}</a>` : ''}
          <button id="cancelWait" class="btn ghost btn-sm">Back to home</button>
        </div>
        <div style="height: 14px"></div>
        <div id="statusLive" class="muted" style="font-size: 12px;">Polling for confirmation…</div>
      </div>
    `;
    container.querySelector('#cancelWait').addEventListener('click', () => navigate('home'));

    const statusLive = container.querySelector('#statusLive');
    let stopped = false;

    async function poll() {
      if (stopped || !document.body.contains(container)) return;
      try {
        const s = await api.loadStatus(ord.orderId);
        if (s.status === 'completed') {
          stopped = true;
          statusLive.innerHTML = '✓ Confirmed — tokens minting…';
          if (s.tokens && s.tokens.length) {
            await store.addTokens(s.tokens);
            await store.addLedger({
              id: uuid(),
              ts: Date.now(),
              kind: 'load',
              amount: ord.amount,
              ref: ord.orderId,
              note: 'Loaded ' + rupeesPlain(ord.amount * 100) + ' to ' + ord.escrowUpiId + ' (UTR ' + (s.utr || '?') + ')',
            });
          }
          await renderDoneStep(container, ord, { tokens: s.tokens || [] });
          toast('Confirmed! Your tokens are in the wallet', 'good');
          await refresh();
          return;
        }
        if (s.status === 'rejected') {
          stopped = true;
          statusLive.innerHTML = `<span style="color:#fca5a5;">✗ Rejected: ${escapeHtml(s.rejectionReason || 'no reason given')}</span>
            <div style="height:8px"></div>
            <button id="retry" class="btn btn-sm">Try again with a different UTR</button>`;
          container.querySelector('#retry').addEventListener('click', () => navigate('load'));
          return;
        }
        statusLive.textContent = 'Still waiting — last checked ' + new Date().toLocaleTimeString();
      } catch (_) { /* ignore transient errors */ }
      setTimeout(poll, 4000);
    }
    poll();
  }


  // Client-side image downsizer — keeps upload under the server's 400 KB
  // limit no matter what phone camera the user is on.
  async function shrinkImage(file, { maxDim = 1200, quality = 0.75 } = {}) {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/jpeg', quality);
    // If still too big, drop quality once more.
    if (out.length > 350 * 1024) {
      out = canvas.toDataURL('image/jpeg', Math.max(0.4, quality - 0.2));
    }
    return out;
  }

  async function renderDoneStep(container, ord, mintResp) {
    const tCount = mintResp.tokens.length;
    const tValue = mintResp.tokens[0].value_paise;
    container.innerHTML = `
      <div class="card" style="border-color: rgba(34,197,94,0.4);">
        <h3 style="color: #86efac;">✔ Tokens minted</h3>
        <p>${tCount} tokens · ${rupeesPlain(tCount * tValue)} now available offline.</p>
        <p class="muted">You can now turn off your internet and pay anyone with the Pay tab.</p>
        <div style="height: 8px"></div>
        <button class="btn ghost" id="done">Back to home</button>
      </div>
    `;
    container.querySelector('#done').addEventListener('click', () => navigate('home'));
  }
}
