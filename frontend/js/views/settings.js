import { api } from '../api.js';
import { toast, escapeHtml } from '../util.js';
import { clearBiometric, isBiometricEnrolled } from '../biometric.js';
import { clearPin, hasPin, unlockApp } from '../lock.js';

export async function renderSettings(root, state, { navigate, refresh }) {
  // Fetch settings up-front so we know whether escrow is locked.
  let current = null;
  try {
    current = await api.getSettings();
  } catch (_) {
    /* offline */
  }
  const locked = current && current.locked;

  root.innerHTML = `
    <section class="card">
      <div class="spaced">
        <h3 style="margin: 0;">Escrow account</h3>
        ${locked
          ? '<span class="chip good">🔒 locked</span>'
          : '<span class="chip warn">editable</span>'
        }
      </div>
      <p class="muted">
        This is the UPI ID that receives money when users load their wallet.
        ${locked
          ? 'The operator has locked this to a single audited account.'
          : 'You can change it anytime.'}
      </p>

      <div class="card tight" style="background: var(--card-hi); margin-top: 8px;">
        <div class="spaced">
          <div>
            <small class="muted" style="font-size: 11px;">Escrow UPI</small>
            <div style="font-weight: 700; font-size: 16px; margin-top: 2px;">${escapeHtml((current && current.escrowUpiId) || '— not set —')}</div>
          </div>
          <button class="btn ghost btn-sm" id="copyUpi">Copy</button>
        </div>
        <div class="divider"></div>
        <div class="spaced">
          <div>
            <small class="muted" style="font-size: 11px;">Display name</small>
            <div style="font-weight: 600; margin-top: 2px;">${escapeHtml((current && current.escrowName) || '')}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Security</h3>
      <p class="muted">Every payment and cashout requires a biometric or PIN. Manage credentials here.</p>
      <div class="card tight" style="background: var(--card-hi);">
        <div class="spaced">
          <div>
            <div style="font-weight: 700;">Biometric (Touch ID / Face ID)</div>
            <small class="muted" id="bioStatus">checking…</small>
          </div>
          <button class="btn ghost btn-sm" id="clearBio">Reset</button>
        </div>
        <div class="divider"></div>
        <div class="spaced">
          <div>
            <div style="font-weight: 700;">PIN lock</div>
            <small class="muted" id="pinStatus">checking…</small>
          </div>
          <button class="btn ghost btn-sm" id="clearPin">Reset PIN</button>
        </div>
        <div class="divider"></div>
        <div class="spaced">
          <div>
            <div style="font-weight: 700;">Lock app now</div>
            <small class="muted">Require re-authentication before showing wallet</small>
          </div>
          <button class="btn btn-sm" id="lockNow">Lock</button>
        </div>
      </div>
    </section>

    <button id="back" class="btn ghost">Back to home</button>
  `;

  root.querySelector('#copyUpi').addEventListener('click', async () => {
    const v = (current && current.escrowUpiId) || '';
    try {
      await navigator.clipboard.writeText(v);
      toast('Escrow UPI copied', 'good');
    } catch (_) {
      toast('Copy failed', 'bad');
    }
  });

  const bioStatus = root.querySelector('#bioStatus');
  if (isBiometricEnrolled()) {
    bioStatus.textContent = '✓ enrolled — biometric prompt appears on each payment';
    bioStatus.style.color = '#86efac';
  } else {
    bioStatus.textContent = 'Not enrolled yet — will enrol on first payment attempt';
  }

  const pinStatus = root.querySelector('#pinStatus');
  if (hasPin()) {
    pinStatus.textContent = '✓ set — fallback if biometric unavailable';
    pinStatus.style.color = '#86efac';
  } else {
    pinStatus.textContent = 'Not set — a tap-to-confirm fallback will be used';
  }

  root.querySelector('#clearBio').addEventListener('click', () => {
    if (!confirm('Reset biometric? The next payment will re-enrol.')) return;
    clearBiometric();
    bioStatus.textContent = 'Reset — will re-enrol on first payment attempt';
    bioStatus.style.color = '';
    toast('Biometric reset', 'good');
  });

  root.querySelector('#clearPin').addEventListener('click', () => {
    if (!confirm('Reset PIN? You will be asked to set a new one on next lock.')) return;
    clearPin();
    pinStatus.textContent = 'Not set';
    pinStatus.style.color = '';
    toast('PIN reset', 'good');
  });

  root.querySelector('#lockNow').addEventListener('click', () => {
    sessionStorage.removeItem('znp.unlocked');
    location.reload();
  });

  root.querySelector('#back').addEventListener('click', () => navigate('home'));
}
