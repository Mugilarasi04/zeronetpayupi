import { formatTime, escapeHtml } from '../util.js';

export function renderHistory(root, state) {
  if (state.ledger.length === 0) {
    root.innerHTML = `
      <div class="card">
        <h3>History</h3>
        <p class="muted">No transactions yet. Load money or receive a payment to see entries here.</p>
      </div>
    `;
    return;
  }

  const groups = groupByDay(state.ledger);
  root.innerHTML = `
    <section>
      <h2 style="margin-top: 14px;">History</h2>
      ${groups
        .map(
          ([day, items]) => `
            <h2 style="margin-top: 14px;">${day}</h2>
            <div class="list">
              ${items.map(renderItem).join('')}
            </div>
          `,
        )
        .join('')}
      <div style="height: 12px"></div>
      <div class="card tight">
        <small class="muted">All amounts shown in INR. <strong>Settled</strong> entries reflect funds credited to your bank via UPI.</small>
      </div>
    </section>
  `;
}

function groupByDay(items) {
  const map = new Map();
  for (const it of items) {
    const k = new Date(it.ts).toLocaleDateString();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()];
}

function renderItem(e) {
  const map = {
    load:    { lbl: 'Loaded',   sign: '+', cls: 'in'  },
    send:    { lbl: 'Paid',     sign: '−', cls: 'out' },
    receive: { lbl: 'Received', sign: '+', cls: 'in'  },
    redeem:  { lbl: 'Settled',  sign: '+', cls: 'in'  },
  };
  const m = map[e.kind] || { lbl: e.kind, sign: '', cls: '' };
  const amt = Number(e.amount);
  const sign = amt < 0 ? '−' : m.sign;
  return `
    <div class="item">
      <div>
        <div class="lbl">${m.lbl}</div>
        <div class="sub">${escapeHtml(e.note || '')} · ${formatTime(e.ts)}</div>
      </div>
      <div class="amt ${m.cls}">${sign}₹${Math.abs(amt).toFixed(2)}</div>
    </div>
  `;
}
