import { api } from '../api.js';
import { rupeesPlain, escapeHtml, toast, copyText, isMobile, whatsappLink } from '../util.js';

// Message the escrow operator sends after paying. Keeps the tone neutral and
// includes the reference so the receiver can match it against their bank SMS.
function paidMessage(item) {
  return (
    `Hi! Your ZeroNetPay cashout has been paid.\n\n` +
    `Amount: ₹${item.amount}\n` +
    `To UPI: ${item.receiverUpi}\n` +
    `Reference: ${item.id}\n\n` +
    `Check your bank SMS to confirm. Reply here if anything looks off.`
  );
}
function nudgeMessage(item) {
  return (
    `Hi! I saw your ZeroNetPay cashout request.\n\n` +
    `Amount: ₹${item.amount}\n` +
    `To UPI: ${item.receiverUpi}\n` +
    `Reference: ${item.id}\n\n` +
    `Processing your payout now.`
  );
}

export async function renderDisburse(root, state, { navigate, refresh }) {
  root.innerHTML = `
    <section class="card">
      <h3>Disbursements from escrow</h3>
      <p class="muted">
        When tokens are redeemed, this is the list of payouts the escrow holder
        still owes the receivers. Tap <strong>Pay now</strong> to send money
        from your escrow UPI account directly to the receiver in one tap, then
        tap <strong>Mark as paid</strong> to record it.
      </p>
      <div id="summary" class="card tight" style="background: var(--card-hi);"></div>
      <div style="height: 12px"></div>
      <div id="list"></div>
    </section>
    <button id="back" class="btn ghost">Back to home</button>
  `;
  root.querySelector('#back').addEventListener('click', () => navigate('home'));

  const summary = root.querySelector('#summary');
  const list = root.querySelector('#list');

  await reload();

  async function reload() {
    let data;
    try {
      data = await api.pendingDisbursements();
    } catch (e) {
      summary.innerHTML = `<div class="muted">Offline — connect to the internet to see pending disbursements.</div>`;
      list.innerHTML = '';
      return;
    }
    const mobile = isMobile();
    const complaintCount = data.items.filter((i) => i.complaintRaised && !i.disbursed).length;
    summary.innerHTML = `
      <div class="spaced">
        <div>
          <div class="muted" style="font-size: 12px;">From escrow</div>
          <div style="font-weight: 700;">${escapeHtml(data.escrowUpiId || '— not set —')}</div>
        </div>
        <div style="text-align:right;">
          <div class="muted" style="font-size: 12px;">Pending</div>
          <div style="font-weight: 700; font-size: 18px;">${rupeesPlain(data.pendingAmount * 100)}</div>
          <div class="muted" style="font-size: 12px;">${data.pendingCount} payout${data.pendingCount === 1 ? '' : 's'}</div>
        </div>
      </div>
      ${complaintCount > 0 ? `
        <div class="divider"></div>
        <div style="color:#fca5a5; font-weight:700;">
          ⚠ ${complaintCount} complaint${complaintCount === 1 ? '' : 's'} — receivers waiting on payout
        </div>
      ` : ''}
    `;

    if (data.items.length === 0) {
      list.innerHTML = `<div class="muted" style="text-align:center; padding: 24px 0;">No settlements yet. As soon as a receiver redeems tokens, the payout shows up here.</div>`;
      return;
    }

    list.innerHTML = data.items
      .map((it) => {
        const when = new Date(it.createdAt).toLocaleString();
        const isPaid = it.disbursed;
        const cardBorder = it.complaintRaised && !isPaid
          ? 'border-color: rgba(239,68,68,0.5); box-shadow: 0 0 0 1px rgba(239,68,68,0.3);'
          : '';
        return `
          <div class="card tight" style="margin-bottom: 8px; ${isPaid ? 'opacity: 0.55;' : ''} ${cardBorder}">
            <div class="spaced">
              <div>
                <div style="font-weight: 700; font-size: 16px;">${rupeesPlain(it.amount * 100)} → ${escapeHtml(it.receiverUpi)}</div>
                <div class="muted" style="font-size: 12px;">${it.tokenCount} token${it.tokenCount === 1 ? '' : 's'} · ${escapeHtml(it.id)} · ${when}</div>
                ${isPaid ? `<div class="chip good" style="margin-top: 6px; display: inline-block;">paid · ${escapeHtml(it.disbursedRef || 'no ref')}</div>` : ''}
                ${it.complaintRaised && !isPaid ? `
                  <div style="margin-top: 8px; padding: 8px 10px; background: rgba(239,68,68,0.12); border-radius: 8px; border-left: 3px solid #ef4444;">
                    <div style="color:#fca5a5; font-weight:700; font-size: 13px;">⚠ COMPLAINT RAISED</div>
                    <div style="color:#fecaca; font-size: 12px; margin-top: 2px;">
                      ${escapeHtml(it.complaintNote || "Payout hasn't arrived")}
                      <br/><small style="opacity:0.75;">${it.complaintAt ? new Date(it.complaintAt).toLocaleString() : ''}</small>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>
            ${isPaid
              ? `<div style="margin-top: 8px; display:flex; gap: 8px; flex-wrap: wrap;">
                   ${whatsappLink(it.receiverPhone, paidMessage(it))
                     ? `<a class="btn ghost btn-sm" style="color:#25D366;" target="_blank" rel="noopener"
                          href="${escapeHtml(whatsappLink(it.receiverPhone, paidMessage(it)))}">💬 Notify receiver</a>`
                     : ''}
                   <button class="btn ghost btn-sm" data-unmark="${escapeHtml(it.id)}">Unmark</button>
                 </div>`
              : `<div style="margin-top: 10px; display:flex; gap: 8px; flex-wrap: wrap;">
                   ${mobile
                     ? `<a class="btn btn-sm" href="${escapeHtml(it.deeplink)}">Pay now</a>`
                     : `<button class="btn btn-sm" data-copy-link="${escapeHtml(it.deeplink)}">Copy UPI link</button>`
                   }
                   <button class="btn ghost btn-sm" data-copy-upi="${escapeHtml(it.receiverUpi)}">Copy UPI</button>
                   <button class="btn ghost btn-sm" data-copy-amt="${it.amount.toFixed(2)}">Copy amount</button>
                   ${whatsappLink(it.receiverPhone, nudgeMessage(it))
                     ? `<a class="btn ghost btn-sm" style="color:#25D366;" target="_blank" rel="noopener"
                          href="${escapeHtml(whatsappLink(it.receiverPhone, nudgeMessage(it)))}">💬 Nudge receiver</a>`
                     : ''}
                   <button class="btn success btn-sm" data-mark="${escapeHtml(it.id)}">Mark as paid</button>
                 </div>`
            }
          </div>
        `;
      })
      .join('');

    list.querySelectorAll('[data-copy-upi]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await copyText(b.dataset.copyUpi);
        toast(ok ? 'UPI ID copied' : 'Copy failed', ok ? 'good' : 'bad');
      }),
    );
    list.querySelectorAll('[data-copy-amt]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await copyText(b.dataset.copyAmt);
        toast(ok ? 'Amount copied' : 'Copy failed', ok ? 'good' : 'bad');
      }),
    );
    list.querySelectorAll('[data-copy-link]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ok = await copyText(b.dataset.copyLink);
        toast(ok ? 'UPI link copied — open it on your phone' : 'Copy failed', ok ? 'good' : 'bad');
      }),
    );
    list.querySelectorAll('[data-mark]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.mark;
        const ref = prompt('Optional: paste the bank reference / UPI txn ID', '');
        b.disabled = true;
        try {
          await api.markDisbursed(id, ref || null);
          // Auto-open WhatsApp so the receiver hears from the escrow within
          // seconds of the mark-paid tap. If the receiver's phone is missing
          // we just skip and fall back to the toast.
          const item = data.items.find((x) => x.id === id);
          if (item) {
            const wa = whatsappLink(item.receiverPhone, paidMessage({ ...item, disbursedRef: ref || null }));
            if (wa) {
              const win = window.open(wa, '_blank');
              if (!win) {
                // Popup blocker fired — surface the link explicitly.
                toast('Recorded — tap "Notify receiver" below to send WhatsApp', 'good');
              } else {
                toast('Recorded — WhatsApp opened to notify receiver', 'good');
              }
            } else {
              toast('Recorded as paid (receiver has no phone on file)', 'good');
            }
          } else {
            toast('Recorded as paid', 'good');
          }
          await reload();
        } catch (e) {
          toast(e.message, 'bad');
          b.disabled = false;
        }
      }),
    );
    list.querySelectorAll('[data-unmark]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.unmark;
        try {
          await api.unmarkDisbursed(id);
          await reload();
        } catch (e) {
          toast(e.message, 'bad');
        }
      }),
    );
  }
}
