import { api } from '../api.js';
import { rupeesPlain, escapeHtml, toast, formatRelative } from '../util.js';

function whatsappLink(phone, item, state) {
  const rawMsg =
    `Hi, I'm still waiting for my ZeroNetPay payout.\n\n` +
    `Amount: ₹${item.amount}\n` +
    `Pay to UPI: ${(state.user && state.user.upiId) || ''}\n` +
    `Reference: ${item.id}\n\n` +
    `Requested ${new Date(item.createdAt).toLocaleString()}.`;
  const digits = String(phone).replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(rawMsg)}`;
}

export async function renderNotifications(root, state, { navigate, refresh }) {
  root.innerHTML = `
    <section class="card">
      <h3>My cashouts</h3>
      <p class="muted">Every cashout you've submitted, along with its payout status. If a
        payout is delayed, tap <strong>Raise complaint</strong> — the escrow operator gets
        flagged and you get a formal dispute record.</p>
      <div id="list" style="margin-top: 10px;"></div>
      <div style="height: 12px"></div>
      <button id="refresh" class="btn ghost btn-sm">↻ Refresh</button>
    </section>
    <button id="back" class="btn ghost">Back to home</button>
  `;

  const list = root.querySelector('#list');
  root.querySelector('#back').addEventListener('click', () => navigate('home'));
  root.querySelector('#refresh').addEventListener('click', () => load());

  await load();

  async function load() {
    list.innerHTML = '<div class="muted" style="text-align:center; padding: 20px 0;"><span class="spinner"></span> Loading…</div>';
    try {
      const r = await api.myCashouts(state.user.id);
      renderList(r.items || []);
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

        const actions = it.disbursed
          ? ''
          : `<div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
              ${wa
                ? `<a class="btn btn-sm" style="background:#25D366; color:white; text-decoration:none;"
                      href="${escapeHtml(whatsappLink(wa, it, state))}" target="_blank" rel="noopener">💬 Ping on WhatsApp</a>`
                : ''}
              ${!it.complaintRaised
                ? `<button class="btn ghost btn-sm" data-complain="${escapeHtml(it.id)}">Raise complaint</button>`
                : ''}
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
  }
}
