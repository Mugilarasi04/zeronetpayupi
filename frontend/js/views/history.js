import { formatTime, escapeHtml } from '../util.js';

export function renderHistory(root, state, opts) {
  const navigate = opts && opts.navigate;
  const topbar = `
    <div class="view-topbar">
      <button id="backTop" class="btn ghost btn-sm">← Home</button>
      <h2>History</h2>
      <span style="width: 44px"></span>
    </div>`;
  if (state.ledger.length === 0) {
    root.innerHTML = topbar + `
      <div class="card">
        <h3>Nothing yet</h3>
        <p class="muted">No transactions yet. Load money or receive a payment to see entries here.</p>
      </div>
    `;
    if (navigate) root.querySelector('#backTop').addEventListener('click', () => navigate('home'));
    return;
  }

  const groups = groupByDay(state.ledger);
  root.innerHTML = topbar + `
    <section>
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
  if (navigate) root.querySelector('#backTop').addEventListener('click', () => navigate('home'));
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
