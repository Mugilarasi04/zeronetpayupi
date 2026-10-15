import { api } from '../api.js';
import { rupeesPlain, escapeHtml, toast, formatRelative } from '../util.js';

// Bob's "incoming load confirmations" queue. Alice (who picked Bob as her
// escrow) submits a UTR after paying Bob's UPI; Bob then checks his bank app
// and either confirms (which mints Alice's tokens) or rejects.
export async function renderLoadApprovals(root, state, { navigate, refresh }) {
  root.innerHTML = `
    <section class="card">
      <h3>Loads awaiting your confirmation</h3>
      <p class="muted" style="font-size: 13px;">
        These are people who picked you as their escrow. They say they've paid
        money into <strong>your</strong> UPI account. Open your bank or UPI app,
        verify each UPI reference matches a real credit, then Confirm or Reject.
      </p>
      <div id="list" style="margin-top: 10px;"></div>
      <div style="height: 12px"></div>
      <button id="refresh" class="btn ghost btn-sm">↻ Refresh</button>
    </section>
    <button id="back" class="btn ghost">Back to home</button>
  `;
  root.querySelector('#back').addEventListener('click', () => navigate('home'));
  root.querySelector('#refresh').addEventListener('click', () => load());

  const list = root.querySelector('#list');
  await load();

  // Light polling so a fresh Alice-submits-UTR appears within seconds.
  if (window.__znpApprovalsTimer) clearInterval(window.__znpApprovalsTimer);
  window.__znpApprovalsTimer = setInterval(() => {
    if (!document.body.contains(list)) {
      clearInterval(window.__znpApprovalsTimer);
      window.__znpApprovalsTimer = null;
      return;
    }
    load();
  }, 6000);

  async function load() {
    try {
      const r = await api.pendingLoadConfirmations(state.user.id);
      renderList(r.items || []);
    } catch (e) {
      list.innerHTML = `<div class="note info">Offline — can't fetch pending loads.</div>`;
    }
  }

  function renderList(items) {
    if (!items.length) {
      list.innerHTML = `<div class="muted" style="text-align: center; padding: 24px 0;">
        No one is waiting on you right now. 🎉
      </div>`;
      return;
    }
    list.innerHTML = items.map((it) => `
      <div class="card tight" style="margin-bottom: 10px; border-color: rgba(251,191,36,0.4);">
        <div class="spaced">
          <div>
            <div style="font-weight: 700; font-size: 18px;">${rupeesPlain(it.amount * 100)} from ${escapeHtml(it.payerUpi)}</div>
            <div class="muted" style="font-size: 12px;">
              ${it.payerPhone ? escapeHtml(it.payerPhone) + ' · ' : ''}submitted ${formatRelative(it.utrSubmittedAt)}
            </div>
            <div style="margin-top: 6px;">
              <span class="muted" style="font-size: 12px;">UPI reference:</span>
              <code style="font-size: 13px; letter-spacing: 1px;">${escapeHtml(it.utr)}</code>
            </div>
            ${it.utrNote ? `<div class="muted" style="font-size: 12px; margin-top: 4px;">"${escapeHtml(it.utrNote)}"</div>` : ''}
          </div>
          <span class="chip warn">⏳ pending</span>
        </div>
        <div style="margin-top: 10px; padding: 10px 12px; background: var(--card-hi); border-radius: 8px; font-size: 12px; color: var(--muted);">
          <strong style="color: var(--text);">Before you confirm:</strong>
          open your bank/UPI app → check whether a credit of <strong style="color: var(--text);">${rupeesPlain(it.amount * 100)}</strong>
          with reference <code>${escapeHtml(it.utr)}</code> has actually arrived.
          If it has, tap Confirm — tokens mint on their phone and you now owe
          their receivers that amount when they cash out.
        </div>
        <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn success btn-sm" data-confirm="${escapeHtml(it.orderId)}">✓ Confirm &amp; mint</button>
          <button class="btn ghost btn-sm" data-reject="${escapeHtml(it.orderId)}">✗ Reject</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-confirm]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.confirm;
        const item = items.find((x) => x.orderId === id);
        const label = item ? `${rupeesPlain(item.amount * 100)} from ${item.payerUpi}` : 'this payment';
        if (!confirm(
          `Confirm you've actually received ${label} in your bank account?\n\n` +
          `This mints that amount in tokens on their phone — you're now responsible for paying their receivers when they cash out.`,
        )) return;
        b.disabled = true;
        try {
          await api.confirmLoadByIssuer(id, state.user.id);
          toast('Confirmed — their tokens are minting', 'good');
          await load();
        } catch (e) {
          toast(e.message || 'Confirm failed', 'bad');
          b.disabled = false;
        }
      }),
    );
    list.querySelectorAll('[data-reject]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.reject;
        const reason = prompt(
          'Why are you rejecting? (shown to the payer)',
          "I don't see this credit in my bank app",
        );
        if (reason === null) return;
        b.disabled = true;
        try {
          await api.rejectLoadByIssuer(id, state.user.id, reason);
          toast('Rejected', 'good');
          await load();
        } catch (e) {
          toast(e.message || 'Reject failed', 'bad');
          b.disabled = false;
        }
      }),
    );
  }
}
