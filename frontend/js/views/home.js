import { rupeesPlain, formatRelative, escapeHtml, toast, isOnline } from '../util.js';
import { store } from '../store.js';
import { api } from '../api.js';

export function renderHome(root, state, { navigate }) {
  const total = state.tokens.reduce((s, t) => s + t.value_paise, 0);
  const ownPaise = state.tokens
    .filter((t) => !t.received_from_upi)
    .reduce((s, t) => s + t.value_paise, 0);
  const recvPaise = state.tokens
    .filter((t) => !!t.received_from_upi)
    .reduce((s, t) => s + t.value_paise, 0);
  // Legacy pending bundles from older app versions — drained on next online.
  const pendingCount = state.pending.reduce((s, p) => s + p.tokens.length, 0);
  const pendingPaise = state.pending.reduce(
    (s, p) => s + p.tokens.reduce((a, t) => a + t.value_paise, 0),
    0,
  );

  const escrowConfigured = state.settings && state.settings.configured;

  root.innerHTML = `
    <section class="hero">
      <div class="label">Available offline balance</div>
      <div class="balance">${rupeesPlain(total)}</div>
      <div class="meta">${state.tokens.length} tokens · ${escapeHtml(state.user.upiId)}</div>
      ${recvPaise > 0 ? `
        <div class="meta" style="margin-top: 4px;">
          <span style="color:#86efac;">↓ ${rupeesPlain(recvPaise)} from others</span>
          · loaded ${rupeesPlain(ownPaise)}
        </div>` : ''}
      <div class="actions">
        <button class="btn" data-go="load">＋ Load</button>
        <button class="btn ghost" data-go="pay">↗ Pay</button>
        <button class="btn ghost" data-go="cashout">₹ Cash out</button>
      </div>
    </section>

    ${!escrowConfigured ? `
      <div class="note">
        <strong>Escrow account not configured.</strong> Set the real UPI ID where
        loaded money should land before you can mint tokens.
        <div style="height: 8px"></div>
        <button class="btn btn-sm" data-go="settings">Configure escrow →</button>
      </div>` : ''}

    ${pendingCount > 0 ? `
      <div class="note">
        <strong>${pendingCount} legacy tokens (${rupeesPlain(pendingPaise)})</strong>
        from the previous app version are still in pending state. They'll
        auto-redeem the next time this device is online.
        <div style="height: 8px"></div>
        <button class="btn btn-sm" id="syncNow" ${isOnline() ? '' : 'disabled'}>
          ${isOnline() ? '⟳ Drain pending now' : 'Offline — will auto-sync when online'}
        </button>
      </div>` : ''}

    <div id="disbBanner" hidden></div>

    <h2>How it works</h2>
    <div class="card tight">
      <p style="margin:0;">
        1. <strong>Load</strong> — pay any amount via UPI; signed ₹1 tokens land in your wallet.<br/>
        2. <strong>Pay</strong> — generate a QR offline, receiver scans, tokens transfer.<br/>
        3. <strong>Cascade</strong> — received tokens are spendable. You can re-pay them to a third person without going online.<br/>
        4. <strong>Cash out</strong> — when you want real money in your bank, tap Cash out and tokens are redeemed via escrow to your UPI.
      </p>
    </div>

    <h2>Recent activity</h2>
    <div id="recent" class="list"></div>

    <h2>Escrow operator</h2>
    <div class="card tight">
      <div class="spaced">
        <div>
          <div style="font-weight: 700;">Disbursements</div>
          <small class="muted" id="disbHint">Pay receivers from escrow when their tokens settle.</small>
        </div>
        <button class="btn btn-sm" data-go="disburse">Open</button>
      </div>
    </div>

    <div style="height: 8px"></div>
    <div class="row">
      <button class="btn ghost btn-sm" data-go="notifications">🔔 My cashouts</button>
      <button class="btn ghost btn-sm" data-go="settings">⚙ Settings</button>
      <button class="btn ghost btn-sm" id="reset">Sign out / wipe device</button>
    </div>
  `;

  // Fetch pending payouts in the background. If anything is owed, surface
  // it as a top banner with a one-tap UPI deeplink — this is what closes
  // the loop from "tokens redeemed" to "real money in receiver's bank".
  async function refreshDisb() {
    let d;
    try {
      d = await api.pendingDisbursements();
    } catch (_) {
      return; // offline
    }
    const hint = root.querySelector('#disbHint');
    if (hint) {
      if (d.pendingCount > 0) {
        hint.innerHTML = `<strong style="color:#fbbf24;">${d.pendingCount} pending · ${rupeesPlain(d.pendingAmount * 100)}</strong> waiting to be paid out.`;
      } else {
        hint.textContent = 'No pending payouts. All settled.';
      }
    }

    const banner = root.querySelector('#disbBanner');
    if (!banner) return;
    if (d.pendingCount === 0) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    // Render the most recent unpaid settlement with a one-tap UPI deeplink.
    const next = d.items.find((it) => !it.disbursed);
    if (!next) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML = `
      <div class="note" style="border-color: rgba(251,191,36,0.4);">
        <div class="spaced">
          <div>
            <strong>🔔 Payout queued</strong><br/>
            <span class="muted">Send <strong>${rupeesPlain(next.amount * 100)}</strong> from escrow to <strong>${escapeHtml(next.receiverUpi)}</strong></span>
          </div>
        </div>
        <div style="height: 8px"></div>
        <div class="row">
          <a class="btn btn-sm" href="${escapeHtml(next.deeplink)}">Pay now</a>
          <button class="btn ghost btn-sm" data-go="disburse">View all (${d.pendingCount})</button>
        </div>
      </div>
    `;
    // Re-bind nav for the freshly-injected button.
    banner.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => navigate(b.dataset.go)),
    );
  }
  refreshDisb();
  // Light polling so a freshly-redeemed settlement appears within seconds.
  // Self-cleans: if the banner element has been wiped (user navigated to
  // another tab and view innerHTML was replaced), the timer clears itself.
  // We also clear any previously-running home-view timer first.
  if (window.__znpHomeTimer) clearInterval(window.__znpHomeTimer);
  window.__znpHomeTimer = setInterval(() => {
    if (!document.getElementById('disbBanner')) {
      clearInterval(window.__znpHomeTimer);
      window.__znpHomeTimer = null;
      return;
    }
    refreshDisb();
  }, 5000);

  const recent = root.querySelector('#recent');
  if (state.ledger.length === 0) {
    recent.innerHTML = `<div class="card tight"><small class="muted">No activity yet — load money to get started.</small></div>`;
  } else {
    recent.innerHTML = state.ledger
      .slice(0, 6)
      .map((e) => renderLedger(e))
      .join('');
  }

  for (const btn of root.querySelectorAll('[data-go]')) {
    btn.addEventListener('click', () => navigate(btn.dataset.go));
  }

  // Manual sync — gives the user a way to force a redeem instead of waiting
  // for the 15s background poll. Important when they want to demo the
  // "tokens turn into money" step on cue.
  const sync = root.querySelector('#syncNow');
  if (sync) {
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.innerHTML = '<span class="spinner"></span> Redeeming…';
      try {
        if (window.ZNP && window.ZNP.trySyncPending) {
          await window.ZNP.trySyncPending();
        }
      } catch (e) {
        toast('Sync failed: ' + e.message, 'bad');
      }
    });
  }

  root.querySelector('#reset').addEventListener('click', async () => {
    if (!confirm('This will wipe your local tokens, ledger, and unlink this device. Continue?')) return;
    await store.clearTokens();
    await store.clearLedger();
    localStorage.removeItem('znp.user');
    localStorage.removeItem('znp.device');
    toast('Device wiped — restart from onboarding', 'good');
    setTimeout(() => location.reload(), 600);
  });
}

function renderLedger(e) {
  const map = {
    load:    { lbl: 'Loaded',   sign: '+', cls: 'in' },
    send:    { lbl: 'Paid',     sign: '−', cls: 'out' },
    receive: { lbl: 'Received', sign: '+', cls: 'in' },
    redeem:  { lbl: 'Settled',  sign: '+', cls: 'in' },
  };
  const m = map[e.kind] || { lbl: e.kind, sign: '', cls: '' };
  return `
    <div class="item">
      <div>
        <div class="lbl">${m.lbl}</div>
        <div class="sub">${escapeHtml(e.note || '')} · ${formatRelative(e.ts)}</div>
      </div>
      <div class="amt ${m.cls}">${m.sign}₹${(e.amount).toFixed(2)}</div>
    </div>
  `;
}
