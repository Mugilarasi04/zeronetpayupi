import { api } from '../api.js';
import { rupeesPlain, escapeHtml, toast, formatRelative } from '../util.js';

// Complaints only unlock after this delay to prevent premature disputes.
// One hour matches the demo scenario the user described.
const COMPLAINT_DELAY_MS = 60 * 60 * 1000;

function whatsappLink(phone, item, state) {
  const rawMsg =
    `Hi, my ZeroNetPay payout is pending.\n\n` +
    `Amount: ₹${item.amount}\n` +
    `Pay to my UPI: ${(state.user && state.user.upiId) || ''}\n` +
    `Reference: ${item.id}\n\n` +
    `Requested ${new Date(item.createdAt).toLocaleString()}.\n` +
    `Please release the payout, thanks!`;
  const digits = String(phone).replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(rawMsg)}`;
}

function fmtCountdown(ms) {
  if (ms <= 0) return '';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export async function renderNotifications(root, state, { navigate, refresh }) {
  root.innerHTML = `
    <div class="view-topbar">
      <button id="backTop" class="btn ghost btn-sm">← Home</button>
      <h2>Notifications</h2>
      <button id="refresh" class="btn ghost btn-sm" aria-label="refresh">↻</button>
    </div>
    <section class="card" id="escrowReqCard" hidden>
      <h3>🤝 Escrow requests to me</h3>
      <p class="muted" style="font-size: 13px;">
        These friends want you to be their escrow — the person who holds their loaded
        money and pays it out when they cash out. Approve only if you're actually willing.
      </p>
      <div id="escrowReqList" style="margin-top: 10px;"></div>
    </section>

    <section class="card">
      <h3>My cashouts</h3>
      <p class="muted">Every cashout you've submitted, along with its payout status. If a
        payout is delayed, tap <strong>Raise complaint</strong> — the escrow operator gets
        flagged and you get a formal dispute record.</p>
      <div id="list" style="margin-top: 10px;"></div>
    </section>
    <button id="back" class="btn ghost">← Back to home</button>
  `;

  const list = root.querySelector('#list');
  const escrowReqCard = root.querySelector('#escrowReqCard');
  const escrowReqList = root.querySelector('#escrowReqList');
  root.querySelector('#back').addEventListener('click', () => navigate('home'));
  root.querySelector('#backTop').addEventListener('click', () => navigate('home'));
  root.querySelector('#refresh').addEventListener('click', () => {
    load();
    loadEscrowRequests();
  });

  await Promise.all([load(), loadEscrowRequests()]);

  async function loadEscrowRequests() {
    try {
      const r = await api.escrowIncoming(state.user.id);
      const pending = (r.rows || []).filter((x) => x.status === 'requested');
      if (!pending.length) {
        escrowReqCard.hidden = true;
        return;
      }
      escrowReqCard.hidden = false;
      escrowReqList.innerHTML = pending.map((req) => `
        <div class="card tight" style="margin-bottom: 8px; border-color: rgba(251,191,36,0.4);">
          <div class="spaced">
            <div>
              <div style="font-weight: 700;">${escapeHtml(req.user_upi)}</div>
              <small class="muted">
                ${req.user_phone ? escapeHtml(req.user_phone) + ' · ' : ''}${formatRelative(req.requested_at)}
              </small>
            </div>
            <span class="chip warn">⏳ pending</span>
          </div>
          <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn success btn-sm" data-approve="${escapeHtml(req.id)}">✓ Approve</button>
            <button class="btn ghost btn-sm" data-reject="${escapeHtml(req.id)}">✗ Reject</button>
            <button class="btn ghost btn-sm" data-open-escrow="1">Open escrow page →</button>
          </div>
        </div>
      `).join('');

      escrowReqList.querySelectorAll('[data-approve]').forEach((b) =>
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await api.escrowApprove(b.dataset.approve, state.user.id);
            toast('Approved — you are now their escrow', 'good');
            await loadEscrowRequests();
          } catch (e) {
            toast(e.message || 'Approve failed', 'bad');
            b.disabled = false;
          }
        }),
      );
      escrowReqList.querySelectorAll('[data-reject]').forEach((b) =>
        b.addEventListener('click', async () => {
          if (!confirm('Reject this escrow request?')) return;
          b.disabled = true;
          try {
            await api.escrowReject(b.dataset.reject, state.user.id);
            toast('Rejected', 'good');
            await loadEscrowRequests();
          } catch (e) {
            toast(e.message || 'Reject failed', 'bad');
            b.disabled = false;
          }
        }),
      );
      escrowReqList.querySelectorAll('[data-open-escrow]').forEach((b) =>
        b.addEventListener('click', () => navigate('myescrow')),
      );
    } catch (_) {
      escrowReqCard.hidden = true;
    }
  }

  // Live poll — every 10 seconds re-fetch from server so a fresh mark-paid
  // by the escrow operator shows up here as "✓ paid" without user tapping
  // Refresh. Cleans itself up when the view is replaced.
  if (window.__znpNotifTimer) clearInterval(window.__znpNotifTimer);
  window.__znpNotifTimer = setInterval(async () => {
    if (!document.body.contains(list)) {
      clearInterval(window.__znpNotifTimer);
      window.__znpNotifTimer = null;
      return;
    }
    // Re-fetch quietly (no spinner) and re-render.
    try {
      const r = await api.myCashouts(state.user.id);
      window.__znpNotifItems = r.items || [];
      renderList(window.__znpNotifItems);
    } catch (_) { /* stay quiet on transient network blips */ }
  }, 10_000);

  async function load() {
    list.innerHTML = '<div class="muted" style="text-align:center; padding: 20px 0;"><span class="spinner"></span> Loading…</div>';
    try {
      const r = await api.myCashouts(state.user.id);
      window.__znpNotifItems = r.items || [];
      renderList(window.__znpNotifItems);
    } catch (e) {
      list.innerHTML = `<div class="note info">Couldn't load cashouts: ${escapeHtml(e.message || 'offline')}</div>`;
    }
  }

  function renderList(items) {
    if (!items.length) {
      list.innerHTML = `<div class="muted" style="text-align:center; padding: 24px 0;">
        No cashouts yet. Cash out from the ₹ tab to see them here.
      </div>`;
      return;
    }
    const wa = state.settings && state.settings.escrowWhatsApp;

    list.innerHTML = items
      .map((it) => {
        const status = it.disbursed
          ? `<span class="chip good">✓ paid</span>`
          : it.complaintRaised
            ? `<span class="chip bad">⚠ disputed</span>`
            : `<span class="chip warn">⏳ pending</span>`;

        const paidLine = it.disbursed
          ? `<div class="muted" style="font-size: 12px; margin-top: 4px;">
              paid ${formatRelative(it.disbursedAt)} · ref ${escapeHtml(it.disbursedRef || 'no ref')}
             </div>`
          : '';

        const complaintLine = it.complaintRaised
          ? `<div class="muted" style="font-size: 12px; margin-top: 4px; color: #fca5a5;">
              complaint raised ${formatRelative(it.complaintAt)} · ${escapeHtml(it.complaintNote || '')}
             </div>`
          : '';

        const elapsedMs = Date.now() - it.createdAt;
        const complaintUnlockIn = COMPLAINT_DELAY_MS - elapsedMs;
        const complaintUnlocked = complaintUnlockIn <= 0;

        const actions = it.disbursed
          ? ''
          : `<div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <button class="btn success btn-sm" data-received="${escapeHtml(it.id)}">✓ I received the money</button>
              ${wa
                ? `<a class="btn btn-sm" style="background:#25D366; color:white; text-decoration:none;"
                      href="${escapeHtml(whatsappLink(wa, it, state))}" target="_blank" rel="noopener">💬 Nudge escrow</a>`
                : ''}
              ${it.complaintRaised
                ? ''
                : complaintUnlocked
                  ? `<button class="btn ghost btn-sm" data-complain="${escapeHtml(it.id)}">Raise complaint</button>`
                  : `<span class="muted" style="font-size: 12px;">
                       Complaint unlocks in <strong>${fmtCountdown(complaintUnlockIn)}</strong>
                     </span>`
              }
             </div>`;

        return `
          <div class="card tight" style="margin-bottom: 10px;">
            <div class="spaced">
              <div>
                <div style="font-weight: 700; font-size: 18px;">${rupeesPlain(it.amount * 100)}</div>
                <div class="muted" style="font-size: 12px;">
                  ${it.tokenCount} tokens · ${formatRelative(it.createdAt)}<br/>
                  ref: <code style="font-size: 11px;">${escapeHtml(it.id)}</code>
                </div>
                ${paidLine}
                ${complaintLine}
              </div>
              <div>${status}</div>
            </div>
            ${actions}
          </div>
        `;
      })
      .join('');

    list.querySelectorAll('[data-complain]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.complain;
        const note = prompt(
          "Describe the issue (optional). This is sent to the escrow operator as a formal complaint.",
          "Payout hasn't arrived in my UPI account.",
        );
        if (note === null) return;
        b.disabled = true;
        try {
          await api.raiseComplaint(id, note);
          toast('Complaint raised — operator has been flagged', 'good');
          await load();
        } catch (e) {
          toast(e.message || 'Failed to raise complaint', 'bad');
          b.disabled = false;
        }
      }),
    );

    // Self-attest "I received the money" — closes the loop when the
    // operator forgets to mark-paid but the receiver saw the credit hit.
    list.querySelectorAll('[data-received]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.received;
        if (!confirm('Confirm that ₹' + (window.__znpNotifItems.find(x => x.id === id) || {}).amount + ' has landed in your bank account?')) return;
        const ref = prompt('Optional: paste the bank/UPI reference from your SMS', '');
        b.disabled = true;
        try {
          await api.confirmReceived(id, state.user.id, ref || null);
          toast('Marked as received — thanks!', 'good');
          await load();
        } catch (e) {
          toast(e.message || 'Could not mark as received', 'bad');
          b.disabled = false;
        }
      }),
    );
  }
}
