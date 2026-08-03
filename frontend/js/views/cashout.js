import { api } from '../api.js';
import { store } from '../store.js';
import { rupeesPlain, toast, uuid, isOnline, escapeHtml } from '../util.js';
import { authenticate as bioAuth } from '../biometric.js';

/**
 * Build a WhatsApp click-to-chat URL that pre-fills a payout-request message
 * to the escrow operator. Works on any device — WhatsApp handles the
 * rendering (Web on desktop, App on phone).
 *
 * phone: E.164 digits only, no +, e.g. "919876543210"
 */
function buildWhatsAppLink(phone, redeemResp, state) {
  const settleId = (redeemResp.settlement && redeemResp.settlement.settlementId) || '';
  const rawMsg =
    `Hi, I just cashed out ZeroNetPay tokens.\n\n` +
    `Amount: ₹${redeemResp.creditAmount}\n` +
    `Pay to UPI: ${redeemResp.upiId || (state.user && state.user.upiId) || ''}\n` +
    `From escrow: ${(state.settings && state.settings.escrowUpiId) || ''}\n` +
    `Reference: ${settleId}\n\n` +
    `Please release the payout. Track it at zeronetpayupi.com`;
  const digits = String(phone).replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(rawMsg)}`;
}

export function renderCashout(root, state, { navigate, refresh }) {
  const total = state.tokens.reduce((s, t) => s + t.value_paise, 0);
  const ownCount = state.tokens.filter((t) => !t.received_from_upi).length;
  const recvCount = state.tokens.filter((t) => !!t.received_from_upi).length;
  const recvPaise = state.tokens
    .filter((t) => !!t.received_from_upi)
    .reduce((s, t) => s + t.value_paise, 0);

  if (state.tokens.length === 0) {
    root.innerHTML = `
      <div class="card">
        <h3>Nothing to cash out</h3>
        <p class="muted">You have no tokens. Load money to mint your own, or receive tokens from someone else.</p>
        <div class="row">
          <button class="btn" id="load">Load money</button>
          <button class="btn ghost" id="receive">Receive</button>
        </div>
      </div>
    `;
    root.querySelector('#load').addEventListener('click', () => navigate('load'));
    root.querySelector('#receive').addEventListener('click', () => navigate('receive'));
    return;
  }

  root.innerHTML = `
    <section class="card">
      <h3>Cash out tokens to your bank</h3>
      <p class="muted">Convert tokens in your wallet into real money in your registered UPI account
        <strong>${escapeHtml(state.user.upiId)}</strong>. The escrow operator settles within seconds of redemption.</p>

      <div class="card tight" style="background: var(--card-hi);">
        <div class="spaced">
          <div>
            <div class="muted" style="font-size: 12px;">Available</div>
            <div style="font-weight: 800; font-size: 24px;">${rupeesPlain(total)}</div>
          </div>
          <div style="text-align:right;">
            <div class="muted" style="font-size: 12px;">${ownCount} loaded · ${recvCount} received</div>
            <div class="muted" style="font-size: 11px;">${rupeesPlain(recvPaise)} from others</div>
          </div>
        </div>
      </div>

      <div style="height: 12px"></div>
      <label for="amt">Amount to cash out (₹)</label>
      <input id="amt" type="number" min="1" step="1" placeholder="${Math.min(total / 100, 50)}" inputmode="numeric" />
      <div style="height: 6px"></div>
      <div class="row">
        <button class="btn ghost btn-sm" data-amt="all">All ${rupeesPlain(total)}</button>
        ${total >= 1000 ? '<button class="btn ghost btn-sm" data-amt="10">₹10</button>' : ''}
        ${total >= 5000 ? '<button class="btn ghost btn-sm" data-amt="50">₹50</button>' : ''}
        ${total >= 10000 ? '<button class="btn ghost btn-sm" data-amt="100">₹100</button>' : ''}
      </div>

      <div style="height: 14px"></div>
      <button id="go" class="btn" ${isOnline() ? '' : 'disabled'}>
        ${isOnline() ? 'Authenticate &amp; cash out' : 'Offline — connect to internet first'}
      </button>
      <small class="muted" style="display:block; margin-top: 8px;">
        Each cashout requires biometric / PIN authentication. Once redeemed, tokens are
        marked spent on the server and the escrow operator pays your UPI ID directly.
      </small>
    </section>

    <div id="result"></div>
  `;

  const amt = root.querySelector('#amt');
  const go = root.querySelector('#go');
  const result = root.querySelector('#result');
  amt.focus();

  for (const b of root.querySelectorAll('[data-amt]')) {
    b.addEventListener('click', () => {
      if (b.dataset.amt === 'all') amt.value = String(total / 100);
      else amt.value = b.dataset.amt;
    });
  }

  go.addEventListener('click', async () => {
    const value = parseInt(amt.value, 10);
    if (!value || value <= 0 || !Number.isInteger(value)) {
      toast('Enter a positive whole number of rupees', 'bad');
      return;
    }
    if (value * 100 > total) {
      toast('Amount exceeds wallet balance', 'bad');
      return;
    }
    if (!isOnline()) {
      toast('Need internet to cash out', 'bad');
      return;
    }

    go.disabled = true;
    go.innerHTML = '<span class="spinner"></span> Authenticating…';
    const ok = await bioAuth({ userId: state.user.id, upiId: state.user.upiId });
    if (!ok) {
      toast('Authentication cancelled', 'bad');
      go.disabled = false;
      go.textContent = 'Authenticate & cash out';
      return;
    }

    // Pick tokens FIFO. Prefer received tokens first (they came from elsewhere
    // and don't drain the user's own wallet first); equally fair — keep simple.
    const targetPaise = value * 100;
    const sorted = [...state.tokens].sort((a, b) => (a.received_at || a.issued_at) - (b.received_at || b.issued_at));
    const picked = [];
    let acc = 0;
    for (const t of sorted) {
      if (acc >= targetPaise) break;
      picked.push(t);
      acc += t.value_paise;
    }
    if (acc !== targetPaise) {
      toast(`Cannot make exact change for ₹${value}. Try a different amount.`, 'bad');
      go.disabled = false;
      go.textContent = 'Authenticate & cash out';
      return;
    }

    go.innerHTML = '<span class="spinner"></span> Redeeming with server…';

    // Make sure we have fresh settings so the WhatsApp button appears.
    try {
      state.settings = await api.getSettings();
    } catch (_) { /* offline, keep last */ }

    try {
      const tokenPayload = picked.map((t) => ({
        id: t.id,
        value_paise: t.value_paise,
        issued_to_user_id: t.issued_to_user_id,
        issued_to_device: t.issued_to_device,
        issued_at: t.issued_at,
        expires_at: t.expires_at,
        signature: t.signature,
      }));
      let r;
      try {
        r = await api.redeem(state.user.id, tokenPayload, state.user.deviceId);
      } catch (netErr) {
        // Give a clear message for the two most common causes.
        if (netErr.code === 'offline') {
          toast('Backend unreachable — check your internet', 'bad');
        } else if (netErr.status === 404 || /not found/i.test(netErr.message || '')) {
          toast('Server can\'t find your account — try wiping the device and re-onboarding', 'bad');
        } else {
          toast('Cashout failed: ' + (netErr.message || 'network error'), 'bad');
        }
        console.error('[cashout] redeem failed', netErr);
        go.disabled = false;
        go.textContent = 'Authenticate & cash out';
        return;
      }
      const okIds = new Set(r.accepted || []);

      // ALL tokens rejected as unknown means the backend restarted and
      // wiped SQLite between mint and now (Render free tier).
      // Explain clearly rather than silently failing.
      const rejected = r.rejected || [];
      const allUnknown =
        okIds.size === 0 &&
        rejected.length > 0 &&
        rejected.every((x) => x.reason === 'unknown_token');
      if (allUnknown) {
        const doReset = confirm(
          "Your tokens are stale — the backend restarted and lost them " +
          "(this happens on Render's free tier).\n\n" +
          "Tap OK to WIPE this device and start fresh. You'll re-onboard, " +
          "load again, and cashout will work.\n\n" +
          "Tap Cancel to just close (tokens stay in wallet but won't be redeemable).",
        );
        if (doReset) {
          try {
            await store.clearTokens();
            await store.clearLedger();
            localStorage.removeItem('znp.user');
            localStorage.removeItem('znp.device');
            sessionStorage.removeItem('znp.unlocked');
          } catch (_) { /* ignore */ }
          location.reload();
          return;
        }
        go.disabled = false;
        go.textContent = 'Authenticate & cash out';
        return;
      }

      // Remove only the accepted tokens from local wallet.
      const acceptedTokens = picked.filter((t) => okIds.has(t.id));
      await store.removeTokens(acceptedTokens.map((t) => t.id));

      if (r.creditAmount > 0) {
        await store.addLedger({
          id: uuid(),
          ts: Date.now(),
          kind: 'redeem',
          amount: r.creditAmount,
          ref: r.settlement && r.settlement.settlementId,
          note: `Cashed out to ${r.upiId} — escrow payout queued`,
        });
      }

      const rejectedCount = rejected.length;
      // Build the disbursement UPI deeplink immediately so the user can pay
      // themselves from the escrow account in one tap — closes the
      // tokens-to-money loop without leaving the app.
      const escrowName = (state.settings && state.settings.escrowName) || 'ZeroNetPay';
      const settleId = (r.settlement && r.settlement.settlementId) || 'ZNP-CASHOUT';
      const note = 'ZNP Cashout ' + settleId.slice(-8);
      const deeplink =
        `upi://pay` +
        `?pa=${encodeURIComponent(r.upiId || state.user.upiId)}` +
        `&pn=${encodeURIComponent('Cashout to self')}` +
        `&am=${r.creditAmount.toFixed(2)}` +
        `&cu=INR` +
        `&tn=${encodeURIComponent(note)}` +
        `&tr=${encodeURIComponent(settleId)}`;

      result.innerHTML = `
        <div class="card" style="border-color: rgba(34,197,94,0.4);">
          <h3 style="color: #86efac;">✔ Cash-out submitted</h3>
          <p style="font-size: 28px; font-weight: 700; margin: 8px 0;">${rupeesPlain(r.creditAmount * 100)}</p>
          <p class="muted">${acceptedTokens.length} tokens redeemed to <strong>${escapeHtml(r.upiId || state.user.upiId)}</strong>.</p>
          ${rejectedCount > 0 ? `<p class="muted" style="color:#fca5a5;">⚠ ${rejectedCount} token(s) rejected by server.</p>` : ''}

          <div style="height: 10px"></div>
          <div class="card tight" style="background: var(--card-hi);">
            <p style="margin: 0 0 8px 0;"><strong>Next: receive your money</strong></p>
            <p class="muted" style="margin: 0 0 10px 0;">Tap below to open your UPI app. The escrow account
              (<strong>${escapeHtml((state.settings && state.settings.escrowUpiId) || '')}</strong>) will
              pay <strong>${rupeesPlain(r.creditAmount * 100)}</strong> to <strong>${escapeHtml(r.upiId || state.user.upiId)}</strong>.</p>
            <a class="btn" id="payNow" href="${escapeHtml(deeplink)}" style="text-decoration:none; display:block; text-align:center;">↗ Open UPI app to receive ₹${r.creditAmount}</a>
          </div>

          ${state.settings && state.settings.escrowWhatsApp ? `
            <div style="height: 10px"></div>
            <div class="card tight" style="background: rgba(37,211,102,0.10); border-color: rgba(37,211,102,0.3);">
              <p style="margin: 0 0 6px 0;"><strong>🔔 Notify escrow operator</strong></p>
              <p class="muted" style="margin: 0 0 10px 0; font-size: 12px;">
                Send a WhatsApp message to
                <strong>${escapeHtml(state.settings.escrowOperatorName || 'the operator')}</strong>
                asking them to release your payout. If they don't pay within a reasonable time,
                come to the <strong>Notifications</strong> tab and raise a complaint.
              </p>
              <a class="btn" style="background: #25D366; text-decoration:none; display:block; text-align:center; color: white;"
                 href="${escapeHtml(buildWhatsAppLink(state.settings.escrowWhatsApp, r, state))}"
                 target="_blank" rel="noopener">
                💬 Message on WhatsApp
              </a>
            </div>
          ` : ''}

          <div style="height: 10px"></div>
          <button id="notifications" class="btn ghost">View my cashouts</button>

          <div style="height: 10px"></div>
          <div class="row">
            <button class="btn ghost" id="home">Back to home</button>
            <button class="btn ghost" id="more">Cash out more</button>
          </div>
        </div>
      `;
      result.querySelector('#home').addEventListener('click', () => navigate('home'));
      result.querySelector('#more').addEventListener('click', async () => {
        await refresh();
        navigate('cashout');
      });
      const notifBtn = result.querySelector('#notifications');
      if (notifBtn) notifBtn.addEventListener('click', () => navigate('notifications'));
      go.style.display = 'none';
      toast('Redeemed — payout queued', 'good');
      await refresh();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Cashout failed', 'bad');
      go.disabled = false;
      go.textContent = 'Authenticate & cash out';
    }
  });
}
