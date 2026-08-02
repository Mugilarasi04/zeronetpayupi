import { api } from '../api.js';
import { store } from '../store.js';
import { rupeesPlain, toast, uuid, copyText, isMobile, escapeHtml } from '../util.js';
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
        <button id="confirm" class="btn success">I've paid — issue tokens</button>
        <small class="muted" style="display:block; margin-top: 8px;">
          Tap this only after the UPI app shows "Payment Successful".
          In production this is automatic via a bank webhook.
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

    container.querySelector('#confirm').addEventListener('click', async () => {
      const btn = container.querySelector('#confirm');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Verifying & minting…';
      try {
        const r = await api.confirmLoad(ord.orderId);
        await store.addTokens(r.tokens);
        await store.addLedger({
          id: uuid(),
          ts: Date.now(),
          kind: 'load',
          amount: ord.amount,
          ref: ord.orderId,
          note: 'Loaded ' + rupeesPlain(ord.amount * 100) + ' to ' + ord.escrowUpiId,
        });
        await renderDoneStep(doneContainer, ord, r);
        container.hidden = true;
        doneContainer.hidden = false;
        toast('Tokens added to your wallet', 'good');
        await refresh();
      } catch (e) {
        toast(e.code === 'offline' ? 'Need internet to mint tokens' : e.message, 'bad');
        btn.disabled = false;
        btn.textContent = "I've paid — issue tokens";
      }
    });
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
