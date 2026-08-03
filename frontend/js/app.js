// Main app shell. Handles state, routing between tabs, and registers the
// service worker for offline support.

import { api } from './api.js';
import { store } from './store.js';
import { toast, deviceFingerprint, uuid, isOnline } from './util.js';
import { renderHome } from './views/home.js';
import { renderLoad } from './views/load.js';
import { renderPay } from './views/pay.js';
import { renderReceive } from './views/receive.js';
import { renderHistory } from './views/history.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderSettings } from './views/settings.js';
import { renderDisburse } from './views/disburse.js';
import { renderCashout } from './views/cashout.js';
import { renderLock } from './views/lock.js';
import { renderNotifications } from './views/notifications.js';
import { isUnlocked, lockApp } from './lock.js';

const state = {
  user: null, // { id, upiId, deviceId }
  tokens: [], // wallet tokens
  pending: [], // received tokens not yet redeemed
  ledger: [], // local transaction log
  settings: null, // { escrowUpiId, escrowName, configured }
};

window.ZNP = { state, api, store, refresh, navigate, toast };

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .then((reg) => {
      // Force a check for updates on every load; reload once when a fresh
      // SW activates so users running stale cached code recover automatically.
      reg.update().catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    })
    .catch((e) => console.warn('SW register failed', e));
}

// ---- Network status ----
function updateNetUI() {
  const dot = document.getElementById('netDot');
  const lbl = document.getElementById('netLabel');
  if (isOnline()) {
    dot.className = 'dot online';
    lbl.textContent = 'online';
  } else {
    dot.className = 'dot offline';
    lbl.textContent = 'offline';
  }
}
window.addEventListener('online', () => {
  updateNetUI();
  toast('Back online', 'good');
  // Drain any legacy "pending" bundles from older app versions. New flow
  // routes received tokens straight into the wallet — user explicitly
  // cashes them out via the Cash out tab.
  trySyncPending();
});
window.addEventListener('offline', () => {
  updateNetUI();
  toast('You are offline — payments will still work', 'warn');
});

// ---- Auto-sync of received-but-unredeemed tokens ----
async function trySyncPending() {
  if (!isOnline() || !state.user) return;
  const pending = await store.listPending();
  if (!pending.length) return;
  for (const p of pending) {
    try {
      const result = await api.redeem(state.user.id, p.tokens, p.senderDevice);
      const okIds = new Set(result.accepted || []);
      // Even partial successes credit; remove redeemed and keep rejected for review.
      if (okIds.size === p.tokens.length) {
        await store.removePending(p.id);
      } else {
        const remaining = p.tokens.filter((t) => !okIds.has(t.id));
        if (remaining.length === 0) {
          await store.removePending(p.id);
        } else {
          // Mark remaining as failed for visibility.
          await store.addPending({ ...p, tokens: remaining, failed: true });
        }
      }
      if (result.creditAmount > 0) {
        await store.addLedger({
          id: uuid(),
          ts: Date.now(),
          kind: 'redeem',
          amount: result.creditAmount,
          ref: result.settlement && result.settlement.settlementId,
          note: `Redeemed to ${result.upiId || 'your UPI'} — escrow payout queued`,
        });
        toast(
          `₹${result.creditAmount} redeemed — escrow operator will pay it to ${result.upiId}`,
          'good',
        );
      }
    } catch (err) {
      console.warn('redeem failed', err);
      // Stay in pending; will retry next time we come online.
      break;
    }
  }
  await refresh();
}

// ---- Bootstrapping ----
async function bootstrap() {
  updateNetUI();

  const stored = localStorage.getItem('znp.user');
  if (stored) {
    try {
      state.user = JSON.parse(stored);
    } catch (_) {
      localStorage.removeItem('znp.user');
    }
  }

  if (!state.user) {
    navigate('onboard');
  } else if (!isUnlocked()) {
    // Every fresh session (tab closed then reopened, or hard reload) requires
    // biometric or PIN before showing the wallet.
    renderLock(viewEl(), state, {
      onUnlock: async () => {
        await refresh();
        try { state.settings = await api.getSettings(); } catch (_) {}
        navigate('home');
      },
    });
  } else {
    await refresh();
    try {
      state.settings = await api.getSettings();
    } catch (_) {
      state.settings = null;
    }
    navigate('home');
  }

  bindTabs();
  // Periodically retry sync in case the SW background sync isn't supported.
  setInterval(trySyncPending, 15_000);
  // Run once shortly after boot to catch any pending from a previous session.
  setTimeout(trySyncPending, 1500);
}

async function refresh() {
  state.tokens = await store.listTokens();
  state.pending = await store.listPending();
  state.ledger = await store.listLedger();
  try {
    state.settings = await api.getSettings();
  } catch (_) {
    /* offline — keep last known settings */
  }
  // Re-render the current view if any.
  const current = document.querySelector('.tab.active');
  if (current) renderTab(current.dataset.tab);
}

function bindTabs() {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => navigate(btn.dataset.tab));
  }
}

function setActiveTab(name) {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
}

function navigate(name) {
  if (!state.user && name !== 'onboard') {
    return renderOnboarding(viewEl(), state, onUserChange);
  }
  // Enforce the lock: any navigation while locked bounces to the lock view.
  // Onboarding is exempt (user isn't signed in yet).
  if (state.user && !isUnlocked() && name !== 'onboard') {
    return renderLock(viewEl(), state, {
      onUnlock: async () => {
        await refresh();
        navigate('home');
      },
    });
  }
  setActiveTab(name);
  renderTab(name);
}

function viewEl() {
  return document.getElementById('view');
}

function renderTab(name) {
  const root = viewEl();
  if (!state.user) return renderOnboarding(root, state, onUserChange);
  switch (name) {
    case 'onboard':
      return renderOnboarding(root, state, onUserChange);
    case 'home':
      return renderHome(root, state, { navigate, refresh });
    case 'load':
      return renderLoad(root, state, { navigate, refresh });
    case 'pay':
      return renderPay(root, state, { navigate, refresh });
    case 'receive':
      return renderReceive(root, state, { navigate, refresh, trySyncPending });
    case 'history':
      return renderHistory(root, state, { navigate, refresh });
    case 'settings':
      return renderSettings(root, state, { navigate, refresh });
    case 'disburse':
      return renderDisburse(root, state, { navigate, refresh });
    case 'cashout':
      return renderCashout(root, state, { navigate, refresh });
    case 'mycashouts':
    case 'notifications':
      return renderNotifications(root, state, { navigate, refresh });
    default:
      return renderHome(root, state, { navigate, refresh });
  }
}

async function onUserChange(user) {
  state.user = user;
  if (user) localStorage.setItem('znp.user', JSON.stringify(user));
  else localStorage.removeItem('znp.user');
  await refresh();
  navigate('home');
}

// Expose a few things for use by views without circular imports
window.ZNP.deviceFingerprint = deviceFingerprint;
window.ZNP.trySyncPending = trySyncPending;

bootstrap().catch((e) => {
  console.error(e);
  toast('Boot error: ' + e.message, 'bad');
  const v = document.getElementById('view');
  if (v) {
    v.innerHTML = `
      <div class="card" style="border-color: rgba(239,68,68,0.4);">
        <h3 style="color:#fca5a5;">Something went wrong on startup</h3>
        <p class="muted">${(e && e.message) || 'unknown error'}</p>
        <p class="muted">Try a hard reload (Cmd-Shift-R / Ctrl-Shift-R) — this also clears any stale service worker cache.</p>
      </div>
    `;
  }
});

// Surface uncaught errors immediately rather than silently breaking the UI.
window.addEventListener('error', (e) => {
  const v = document.getElementById('view');
  if (v && !v.hasChildNodes()) {
    v.innerHTML = `
      <div class="card" style="border-color: rgba(239,68,68,0.4);">
        <h3 style="color:#fca5a5;">Script error</h3>
        <p class="muted">${(e.error && e.error.message) || e.message || 'unknown'}</p>
        <p class="muted">Hard-reload the page (Cmd-Shift-R) to refresh cached files.</p>
      </div>
    `;
  }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('unhandledrejection', e.reason);
  toast('Error: ' + ((e.reason && e.reason.message) || e.reason || 'unknown'), 'bad');
});
