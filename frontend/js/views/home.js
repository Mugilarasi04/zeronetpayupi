import { rupeesPlain, formatRelative, escapeHtml, toast, isOnline } from '../util.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { getPendingLoadOrders } from '../loadsync.js';

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
    <div id="awaitingLoadBanner" hidden></div>

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

    <h2>Your payouts</h2>
    <div class="card tight">
      <div class="spaced">
        <div>
          <div style="font-weight: 700;">My cashouts</div>
          <small class="muted" id="myCashoutsHint">Track payouts owed to you and raise complaints if needed.</small>
        </div>
        <button class="btn btn-sm" data-go="mycashouts">Open</button>
      </div>
    </div>

    <h2>Trust &amp; transparency</h2>
    <div class="card tight" style="background: var(--card-hi); border-color: rgba(34,197,94,0.35);">
      <div class="spaced">
        <div>
          <div style="font-weight: 700;">🔒 Public proof of reserves</div>
          <small class="muted">
            Verify in real time that every token in circulation is backed 1:1 by cash in the escrow account.
          </small>
        </div>
        <a class="btn btn-sm" href="/audit" target="_blank" rel="noopener">Open ↗</a>
      </div>
    </div>

    <div class="card tight" style="background: var(--card-hi); border-color: rgba(59,130,246,0.4); margin-top: 10px;">
      <div class="spaced">
        <div>
          <div style="font-weight: 700;">🤝 My escrow &amp; requests <span id="escrowBadge" style="display:none; background:#ef4444; color:#fff; font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px; margin-left:4px;">0</span></div>
          <small class="muted" id="escrowSubtitle">loading…</small>
        </div>
        <button class="btn btn-sm" data-go="myescrow">Open</button>
      </div>
    </div>

    <div class="card tight" id="loadApprovalsTile" hidden style="background: var(--card-hi); border-color: rgba(251,191,36,0.45); margin-top: 10px;">
      <div class="spaced">
        <div>
          <div style="font-weight: 700;">💰 Loads awaiting your confirmation <span id="loadApprovalsBadge" style="display:none; background:#ef4444; color:#fff; font-size:11px; font-weight:700; padding:2px 7px; border-radius:999px; margin-left:4px;">0</span></div>
          <small class="muted" id="loadApprovalsSubtitle">—</small>
        </div>
        <button class="btn btn-sm" data-go="loadapprovals">Open</button>
      </div>
    </div>

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
      d = await api.disbursePendingForOperator(state.user.id);
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
    const complaintCount = d.items.filter((i) => i.complaintRaised && !i.disbursed).length;
    const flagged = next.complaintRaised;
    const bannerBorder = complaintCount > 0 || flagged
      ? 'rgba(239,68,68,0.55)'
      : 'rgba(251,191,36,0.4)';
    const bannerHeader = flagged
      ? '<strong style="color:#fca5a5;">⚠ COMPLAINT RAISED</strong>'
      : '<strong>🔔 Payout queued</strong>';
    banner.hidden = false;
    banner.innerHTML = `
      <div class="note" style="border-color: ${bannerBorder};">
        <div class="spaced">
          <div>
            ${bannerHeader}<br/>
            <span class="muted">Send <strong>${rupeesPlain(next.amount * 100)}</strong> from escrow to <strong>${escapeHtml(next.receiverUpi)}</strong></span>
            ${flagged && next.complaintNote ? `
              <div style="margin-top: 6px; padding: 6px 8px; background: rgba(239,68,68,0.12); border-radius: 6px; font-size: 12px; color:#fecaca;">
                “${escapeHtml(next.complaintNote)}”
              </div>` : ''}
          </div>
        </div>
        <div style="height: 8px"></div>
        <div class="row">
          <a class="btn btn-sm" href="${escapeHtml(next.deeplink)}">Pay now</a>
          <button class="btn ghost btn-sm" data-go="disburse">View all (${d.pendingCount}${complaintCount > 0 ? ` · ${complaintCount}⚠` : ''})</button>
        </div>
      </div>
    `;
    // Re-bind nav for the freshly-injected button.
    banner.querySelectorAll('[data-go]').forEach((b) =>
      b.addEventListener('click', () => navigate(b.dataset.go)),
    );
  }
  refreshDisb();
  refreshEscrowCard();
  refreshLoadApprovalsCard();
  refreshAwaitingLoads();
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
    refreshEscrowCard();
    refreshLoadApprovalsCard();
    refreshAwaitingLoads();
  }, 5000);

  // Loads Alice has submitted a UTR for but Bob hasn't confirmed yet.
  // Reads from localStorage (filled by the Load view when UTR is submitted).
  // The global background sync in app.js removes entries as they complete,
  // so this re-render naturally empties as confirmations arrive.
  function refreshAwaitingLoads() {
    const banner = root.querySelector('#awaitingLoadBanner');
    if (!banner) return;
    const pending = getPendingLoadOrders();
    if (!pending.length) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    const total = pending.reduce((s, p) => s + Number(p.amount || 0), 0);
    banner.hidden = false;
    banner.innerHTML = `
      <div class="note" style="border-color: rgba(251,191,36,0.5);">
        <div class="spaced">
          <div>
            <strong>⏳ ${pending.length} load${pending.length === 1 ? '' : 's'} awaiting confirmation</strong><br/>
            <span class="muted">Total <strong>${rupeesPlain(total * 100)}</strong> — your escrow friend needs to verify the UPI reference and tap Confirm.</span>
          </div>
        </div>
        <div style="height: 8px"></div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${pending.map((p) => `
            <div class="card tight" style="margin:0; background: var(--card-hi);">
              <div class="spaced">
                <div style="min-width: 0; flex: 1;">
                  <div style="font-weight: 700;">${rupeesPlain(p.amount * 100)} → ${escapeHtml(p.escrowUpiId || '—')}</div>
                  <small class="muted">UTR <code>${escapeHtml(p.utr || '—')}</code> · submitted ${formatRelative(p.submittedAt)}</small>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Updates the "Loads awaiting your confirmation" tile — only shown when
  // this user is somebody's escrow AND there's a pending UTR to review.
  async function refreshLoadApprovalsCard() {
    const tile    = root.querySelector('#loadApprovalsTile');
    const badge   = root.querySelector('#loadApprovalsBadge');
    const sub     = root.querySelector('#loadApprovalsSubtitle');
    if (!tile || !badge || !sub) return;
    try {
      const r = await api.pendingLoadConfirmations(state.user.id);
      const n = (r.items || []).length;
      if (n === 0) {
        tile.hidden = true;
        return;
      }
      tile.hidden = false;
      badge.style.display = 'inline-block';
      badge.textContent = String(n);
      const total = r.items.reduce((s, it) => s + it.amount, 0);
      sub.innerHTML = `<strong style="color:#fbbf24;">${n} load${n === 1 ? '' : 's'} · ${rupeesPlain(total * 100)}</strong> waiting — verify in your bank app and tap Confirm.`;
    } catch (_) {
      // offline — hide the tile silently
      tile.hidden = true;
    }
  }

  // Updates the "My escrow & requests" tile with: active escrow status + a
  // red pill when there are pending escrow requests I need to approve.
  async function refreshEscrowCard() {
    const sub = root.querySelector('#escrowSubtitle');
    const badge = root.querySelector('#escrowBadge');
    if (!sub || !badge) return;
    try {
      const [act, inc] = await Promise.all([
        api.escrowActive(state.user.id),
        api.escrowIncoming(state.user.id),
      ]);
      const pendingIncoming = (inc.rows || []).filter((r) => r.status === 'requested');
      if (pendingIncoming.length > 0) {
        badge.style.display = 'inline-block';
        badge.textContent = String(pendingIncoming.length);
      } else {
        badge.style.display = 'none';
      }
      if (act.active) {
        sub.innerHTML = `Your money sits with <strong>${act.active.escrowUpiId}</strong>. ${pendingIncoming.length > 0 ? `<span style="color:#fbbf24;">${pendingIncoming.length} request${pendingIncoming.length === 1 ? '' : 's'} waiting for your approval.</span>` : ''}`;
        sub.style.color = '';
      } else {
        sub.innerHTML = `<span style="color:#fca5a5;">⚠ No escrow chosen yet. Pick one before loading money.</span>${pendingIncoming.length > 0 ? ` <span style="color:#fbbf24;">· ${pendingIncoming.length} request${pendingIncoming.length === 1 ? '' : 's'} to approve.</span>` : ''}`;
      }
    } catch (_) {
      sub.textContent = 'Offline — can\'t load escrow info.';
    }
  }

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
    if (!confirm('This will wipe your local tokens, ledger, pending loads, escrow requests and unlink this device. Continue?')) return;
    try { await store.clearTokens(); } catch (_) {}
    try { await store.clearLedger(); } catch (_) {}
    // Wipe IndexedDB entirely to clear any encrypted-at-rest leftovers.
    try { indexedDB.deleteDatabase('zeronetpay'); } catch (_) {}
    // Nuke every localStorage key the app owns + the unlock session flag.
    const keys = ['znp.user', 'znp.device', 'znp.pendingLoads', 'znp.pendingEscrowRequests'];
    for (const k of keys) localStorage.removeItem(k);
    try { sessionStorage.removeItem('znp.unlocked'); } catch (_) {}
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
