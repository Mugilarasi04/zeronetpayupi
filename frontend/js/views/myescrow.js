import { api } from '../api.js';
import { toast, escapeHtml, whatsappLink } from '../util.js';

function fmtWhen(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function statusChip(status) {
  const map = {
    requested: ['warn', '⏳ pending'],
    approved:  ['good', '✓ active'],
    rejected:  ['bad', '✗ rejected'],
    revoked:   ['bad', '⟲ revoked'],
  };
  const [cls, label] = map[status] || ['', status];
  return `<span class="chip ${cls}">${label}</span>`;
}

export async function renderMyEscrow(root, state, { navigate, refresh }) {
  root.innerHTML = `
    <section class="card">
      <h3>Your escrow</h3>
      <p class="muted" id="activeSummary">loading…</p>
      <div id="activeCard"></div>
    </section>

    <section class="card">
      <h3>Pick a trusted friend as your escrow</h3>
      <p class="muted" style="font-size: 13px;">
        Enter your friend's phone number or UPI ID. They'll get a WhatsApp message
        and an in-app notification asking them to approve. Once they do, your loaded
        money sits with them — not with us.
      </p>
      <label for="pickerInput">Friend's phone or UPI</label>
      <input id="pickerInput" type="text" placeholder="e.g. 9876543210 or ravi@okicici"
        autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
      <small class="muted" id="pickerHint" style="display:block; margin-top: 4px;"></small>
      <div style="height: 10px"></div>
      <button id="sendRequest" class="btn">Send escrow request</button>
    </section>

    <section class="card">
      <h3>Requests I've sent (outgoing)</h3>
      <div id="outgoing"></div>
    </section>

    <section class="card">
      <h3>Requests to me (incoming)</h3>
      <p class="muted" style="font-size: 13px;">
        These are people who want you to be their escrow — meaning they'll trust
        you to hold their money and release it to receivers when they cash out.
        Only approve if you're actually willing to do that.
      </p>
      <div id="incoming"></div>
    </section>

    <button id="back" class="btn ghost">Back to home</button>
  `;

  root.querySelector('#back').addEventListener('click', () => navigate('home'));

  const activeCard = root.querySelector('#activeCard');
  const activeSummary = root.querySelector('#activeSummary');
  const outgoing = root.querySelector('#outgoing');
  const incoming = root.querySelector('#incoming');
  const pickerInput = root.querySelector('#pickerInput');
  const pickerHint = root.querySelector('#pickerHint');
  const sendRequest = root.querySelector('#sendRequest');

  async function reload() {
    await Promise.all([
      loadActive(),
      loadOutgoing(),
      loadIncoming(),
    ]);
  }

  async function loadActive() {
    try {
      const r = await api.escrowActive(state.user.id);
      if (r.active) {
        activeSummary.innerHTML =
          `✓ Your money is held by <strong>${escapeHtml(r.active.escrowUpiId)}</strong>` +
          (r.active.escrowPhone ? ` (${escapeHtml(r.active.escrowPhone)})` : '') +
          ` — approved ${fmtWhen(r.active.approvedAt)}.`;
        activeCard.innerHTML = `
          <div class="card tight" style="background: var(--card-hi); border-color: rgba(34,197,94,0.4);">
            <div class="spaced">
              <div>
                <div style="font-weight: 700;">${escapeHtml(r.active.escrowUpiId)}</div>
                <small class="muted">Relationship <code>${escapeHtml(r.active.relationshipId)}</code></small>
              </div>
              <button class="btn ghost btn-sm" data-revoke="${escapeHtml(r.active.relationshipId)}">Revoke</button>
            </div>
          </div>
        `;
        activeCard.querySelector('[data-revoke]').addEventListener('click', async (e) => {
          if (!confirm('Revoke this escrow relationship? You will need to pick a new escrow before loading money again.')) return;
          try {
            await api.escrowRevoke(e.target.dataset.revoke, state.user.id);
            toast('Escrow revoked', 'good');
            await reload();
          } catch (err) {
            toast(err.message || 'Could not revoke', 'bad');
          }
        });
      } else {
        activeSummary.innerHTML = '⚠ You don\'t have an active escrow yet. Pick a friend below to get started.';
        activeSummary.style.color = '#fca5a5';
        activeCard.innerHTML = '';
      }
    } catch (e) {
      activeSummary.textContent = 'Offline — can\'t check active escrow.';
    }
  }

  async function loadOutgoing() {
    try {
      const r = await api.escrowOutgoing(state.user.id);
      renderRelList(outgoing, r.rows || [], 'outgoing');
    } catch (e) {
      outgoing.innerHTML = `<div class="muted">Offline</div>`;
    }
  }

  async function loadIncoming() {
    try {
      const r = await api.escrowIncoming(state.user.id);
      renderRelList(incoming, r.rows || [], 'incoming');
    } catch (e) {
      incoming.innerHTML = `<div class="muted">Offline</div>`;
    }
  }

  function renderRelList(container, rows, kind) {
    if (!rows.length) {
      container.innerHTML = `<div class="muted" style="text-align: center; padding: 10px 0;">
        ${kind === 'outgoing' ? 'No outgoing requests yet.' : 'No incoming requests.'}
      </div>`;
      return;
    }
    container.innerHTML = rows.map((r) => {
      const other = kind === 'outgoing'
        ? { upi: r.escrow_upi, phone: r.escrow_phone }
        : { upi: r.user_upi,   phone: r.user_phone };
      const actions = [];
      if (kind === 'incoming' && r.status === 'requested') {
        actions.push(`<button class="btn success btn-sm" data-approve="${escapeHtml(r.id)}">✓ Approve</button>`);
        actions.push(`<button class="btn ghost btn-sm"   data-reject="${escapeHtml(r.id)}">✗ Reject</button>`);
      }
      if (r.status === 'approved') {
        actions.push(`<button class="btn ghost btn-sm" data-revoke="${escapeHtml(r.id)}">Revoke</button>`);
      }
      return `
        <div class="card tight" style="margin-bottom: 8px;">
          <div class="spaced">
            <div>
              <div style="font-weight: 700;">${escapeHtml(other.upi)}</div>
              <small class="muted">${other.phone ? escapeHtml(other.phone) + ' · ' : ''}${fmtWhen(r.requested_at)}</small>
            </div>
            <div style="text-align: right;">${statusChip(r.status)}</div>
          </div>
          ${actions.length ? `<div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">${actions.join('')}</div>` : ''}
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-approve]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await api.escrowApprove(b.dataset.approve, state.user.id);
          toast('Approved — you are now their escrow', 'good');
          await reload();
        } catch (e) {
          toast(e.message || 'Approve failed', 'bad');
          b.disabled = false;
        }
      }),
    );
    container.querySelectorAll('[data-reject]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Reject this request?')) return;
        b.disabled = true;
        try {
          await api.escrowReject(b.dataset.reject, state.user.id);
          toast('Rejected', 'good');
          await reload();
        } catch (e) {
          toast(e.message || 'Reject failed', 'bad');
          b.disabled = false;
        }
      }),
    );
    container.querySelectorAll('[data-revoke]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('Revoke this escrow? Both parties will be notified.')) return;
        b.disabled = true;
        try {
          await api.escrowRevoke(b.dataset.revoke, state.user.id);
          toast('Revoked', 'good');
          await reload();
        } catch (e) {
          toast(e.message || 'Revoke failed', 'bad');
          b.disabled = false;
        }
      }),
    );
  }

  // Live validation hint on the picker input.
  pickerInput.addEventListener('input', () => {
    const v = pickerInput.value.trim();
    if (!v) { pickerHint.textContent = ''; return; }
    const digits = v.replace(/\D/g, '');
    if (v.includes('@')) {
      pickerHint.textContent = '→ will look up as UPI ID';
      pickerHint.style.color = '#86efac';
    } else if (digits.length >= 10) {
      pickerHint.textContent = '→ will look up as phone number';
      pickerHint.style.color = '#86efac';
    } else {
      pickerHint.textContent = 'Enter a full UPI (name@bank) or 10-digit phone';
      pickerHint.style.color = '#fca5a5';
    }
  });

  sendRequest.addEventListener('click', async () => {
    const v = pickerInput.value.trim();
    if (!v) { toast('Enter a UPI or phone first', 'bad'); return; }
    sendRequest.disabled = true;
    sendRequest.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const r = await api.escrowRequest(state.user.id, v);
      pickerInput.value = '';
      if (r.duplicate) {
        toast('A request to this person already exists', 'warn');
      } else {
        toast('Request sent — they need to approve in their app', 'good');
      }
      // WhatsApp notification — open on the user's device so they can
      // actually send the ping. The link opens the escrow's phone in WA.
      const wa = whatsappLink(r.escrowUser.phone,
        `Hi! I'm using ZeroNetPay and I'd like you to be my escrow — the person who holds my loaded money and releases it to people I pay.\n\n` +
        `Open the app and tap Approve on the request from ${state.user.upiId}.\n\n` +
        `Request id: ${r.id}\n` +
        `App: https://upizeronetpay.pages.dev`);
      if (wa) {
        setTimeout(() => {
          if (confirm('Open WhatsApp to notify them now?')) {
            window.open(wa, '_blank');
          }
        }, 200);
      }
      await reload();
    } catch (e) {
      toast(e.message || 'Request failed', 'bad');
    } finally {
      sendRequest.disabled = false;
      sendRequest.textContent = 'Send escrow request';
    }
  });

  await reload();
}
