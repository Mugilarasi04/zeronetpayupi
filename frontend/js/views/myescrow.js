import { api } from '../api.js';
import { toast, escapeHtml, whatsappLink } from '../util.js';
import { addPendingEscrowRequest } from '../escrowsync.js';

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
    <div class="view-topbar">
      <button id="backTop" class="btn ghost btn-sm">← Home</button>
      <h2 style="margin: 0; font-size: 16px;">My escrow &amp; requests</h2>
      <button id="refreshTop" class="btn ghost btn-sm" aria-label="refresh">↻</button>
    </div>

    <section class="card">
      <h3>Your escrow</h3>
      <p class="muted" id="activeSummary">loading…</p>
      <div id="activeCard"></div>
    </section>

    <section class="card">
      <h3>Pick a trusted friend as your escrow</h3>
      <p class="muted" style="font-size: 13px;">
        Enter your friend's phone number or UPI ID. They'll get a WhatsApp
        message and an in-app notification asking them to approve. Once they
        do, your loaded money sits with them — not with us.
      </p>
      <div id="switchHint" hidden class="note" style="border-color: rgba(251,191,36,0.4); margin: 0 0 10px;">
        <strong>You already have an active escrow.</strong> Sending a new
        request is fine — the moment your new pick approves, the current one
        will be auto-revoked.
      </div>
      <label for="pickerInput">Friend's phone or UPI</label>
      <input id="pickerInput" type="text" placeholder="e.g. 9876543210 or ravi@okicici"
        autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
      <small class="muted" id="pickerHint" style="display:block; margin-top: 4px;"></small>
      <div style="height: 10px"></div>
      <button id="sendRequest" class="btn" disabled>Send escrow request</button>
    </section>

    <section class="card">
      <h3>Requests I've sent (outgoing)</h3>
      <div id="outgoing"></div>
    </section>

    <section class="card">
      <h3>Requests to me (incoming)</h3>
      <p class="muted" style="font-size: 13px;">
        These are people who want <strong>you</strong> to be their escrow —
        meaning they'll trust you to hold their money and release it to
        receivers when they cash out. Only approve if you're actually willing.
      </p>
      <div id="incoming"></div>
    </section>

    <button id="back" class="btn ghost">← Back to home</button>
  `;

  root.querySelector('#back').addEventListener('click', () => navigate('home'));
  root.querySelector('#backTop').addEventListener('click', () => navigate('home'));
  root.querySelector('#refreshTop').addEventListener('click', () => reload());

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
      const switchHint = root.querySelector('#switchHint');
      if (r.active) {
        activeSummary.style.color = '';
        activeSummary.innerHTML =
          `✓ Your money is held by <strong>${escapeHtml(r.active.escrowUpiId)}</strong>` +
          (r.active.escrowPhone ? ` (${escapeHtml(r.active.escrowPhone)})` : '') +
          ` — approved ${fmtWhen(r.active.approvedAt)}.`;
        activeCard.innerHTML = `
          <div class="card tight" style="background: var(--card-hi); border-color: rgba(34,197,94,0.4);">
            <div class="spaced">
              <div style="min-width: 0; flex: 1;">
                <div style="font-weight: 700; font-size: 15px;">${escapeHtml(r.active.escrowUpiId)}</div>
                ${r.active.escrowPhone ? `<small class="muted" style="display:block;">${escapeHtml(r.active.escrowPhone)}</small>` : ''}
                <small class="muted" style="display:block; word-break: break-all;">Relationship <code style="font-size:11px;">${escapeHtml(r.active.relationshipId)}</code></small>
              </div>
              <button class="btn ghost btn-sm" data-revoke="${escapeHtml(r.active.relationshipId)}">Revoke</button>
            </div>
          </div>
        `;
        activeCard.querySelector('[data-revoke]').addEventListener('click', async (e) => {
          if (!confirm('Revoke this escrow relationship? You will need to pick a new escrow before loading money again. Existing tokens stay valid — this only stops new loads.')) return;
          try {
            await api.escrowRevoke(e.target.dataset.revoke, state.user.id);
            toast('Escrow revoked', 'good');
            await reload();
          } catch (err) {
            toast(err.message || 'Could not revoke', 'bad');
          }
        });
        if (switchHint) switchHint.hidden = false;
      } else {
        activeSummary.innerHTML = '⚠ You don\'t have an active escrow yet. Pick a friend below to get started.';
        activeSummary.style.color = '#fca5a5';
        activeCard.innerHTML = '';
        if (switchHint) switchHint.hidden = true;
      }
    } catch (e) {
      activeSummary.textContent = 'Offline — can\'t check active escrow.';
      activeSummary.style.color = '#fca5a5';
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
  function validatePicker() {
    const v = pickerInput.value.trim();
    sendRequest.disabled = true;
    if (!v) { pickerHint.textContent = ''; return false; }
    const digits = v.replace(/\D/g, '');
    if (v.includes('@')) {
      if (/^[A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9]*$/.test(v)) {
        pickerHint.textContent = '→ will look up as UPI ID';
        pickerHint.style.color = '#86efac';
        sendRequest.disabled = false;
        return true;
      }
      pickerHint.textContent = 'UPI should look like name@bank (e.g. 9876543210@upi)';
      pickerHint.style.color = '#fca5a5';
      return false;
    }
    if (digits.length >= 10 && digits.length <= 14) {
      // Catch self-escrow early (user typed their own phone).
      const myDigits = String(state.user.phone || '').replace(/\D/g, '');
      if (myDigits && (digits === myDigits || digits === myDigits.replace(/^91/, '') || '91' + digits === myDigits)) {
        pickerHint.textContent = "That's your own number — pick a trusted friend instead";
        pickerHint.style.color = '#fca5a5';
        return false;
      }
      pickerHint.textContent = '→ will look up as phone number';
      pickerHint.style.color = '#86efac';
      sendRequest.disabled = false;
      return true;
    }
    pickerHint.textContent = 'Enter a full UPI (name@bank) or 10-digit phone';
    pickerHint.style.color = '#fca5a5';
    return false;
  }
  pickerInput.addEventListener('input', validatePicker);

  sendRequest.addEventListener('click', async () => {
    const v = pickerInput.value.trim();
    if (!validatePicker()) return;
    sendRequest.disabled = true;
    sendRequest.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const r = await api.escrowRequest(state.user.id, v);
      pickerInput.value = '';
      pickerHint.textContent = '';
      if (r.duplicate) {
        toast('You already have a ' + r.status + ' request to this person', 'warn');
      } else {
        toast('Request sent — they need to approve in their app', 'good');
      }
      // Track this request so the global background sync can toast Alice
      // the moment Bob approves/rejects, even from the home screen.
      // Skip already-decided duplicates — nothing's pending there.
      if (r.id && r.escrowUser && r.status === 'requested') {
        addPendingEscrowRequest({
          id: r.id,
          escrowUpiId: r.escrowUser.upiId,
          escrowPhone: r.escrowUser.phone,
        });
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
          if (confirm('Open WhatsApp to notify ' + (r.escrowUser.upiId || 'them') + ' now?')) {
            window.open(wa, '_blank');
          }
        }, 200);
      } else {
        toast('They have no phone on file — ask them to open the app', 'warn');
      }
      await reload();
    } catch (e) {
      const msg = e.message || '';
      if (msg === 'escrow_user_not_registered' || /not.*regist/i.test(msg)) {
        // On Render's free tier the SQLite DB is wiped at every deploy.
        // Give the user a clear next step instead of a dead-end error.
        toast(
          'That number isn\'t on ZeroNetPay yet — ask them to open the app once (the server was restarted recently, so they may need to re-open it)',
          'bad',
        );
      } else if (/you cannot be your own escrow/i.test(msg)) {
        toast('You can\'t pick yourself as your own escrow', 'bad');
      } else {
        toast(msg || 'Request failed', 'bad');
      }
    } finally {
      sendRequest.disabled = false;
      sendRequest.textContent = 'Send escrow request';
    }
  });

  await reload();
}
