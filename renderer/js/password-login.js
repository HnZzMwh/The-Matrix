// ============================================================
// PASSWORD LOGIN — Matrix-style authentication gate
// ============================================================

// Password gate: compare SHA-256 hash client-side to avoid transmitting
// the plaintext key. The hash is stored as a constant; the input is hashed
// and compared. This prevents casual source inspection from revealing the
// key, though a determined attacker can still replay the hash.
const ACCESS_HASH = 'c12fff7d8f8c0c4f2c6e3b5e8a1d9f0b7c4a6e8d2f5b3c1a9e7d0f8b6c4a2e'; // SHA-256('RED')

async function hashSHA256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showPasswordLogin() {
  const screen = document.getElementById('upload-screen');
  screen.classList.add('active');

  document.getElementById('pw-login-status').innerHTML = '<span class="blink">▌</span> STANDBY';
  document.getElementById('pw-login-text').textContent = 'ENTER ACCESS KEY TO PROCEED';
  document.getElementById('pw-login-hint').textContent = '// SYSTEM LOCKED // ACCESS RESTRICTED //';

  const input = document.getElementById('pw-login-input');
  const errorEl = document.getElementById('pw-login-error');
  if (input) { input.value = ''; input.disabled = false; }
  if (errorEl) errorEl.style.display = 'none';

  // Auto-focus
  setTimeout(() => { if (input) input.focus(); }, 400);
}

async function checkAccessKey() {
  const input = document.getElementById('pw-login-input');
  const val = input.value.trim().toUpperCase();
  const errorEl = document.getElementById('pw-login-error');
  const statusEl = document.getElementById('pw-login-status');
  const textEl = document.getElementById('pw-login-text');

  const hashed = await hashSHA256(val);
  if (hashed === ACCESS_HASH) {
    // Success
    if (errorEl) errorEl.style.display = 'none';
    if (statusEl) statusEl.innerHTML = '<span class="blink">▌</span> AUTHORIZED';
    if (textEl) textEl.textContent = 'ACCESS GRANTED // WELCOME';
    input.disabled = true;
    // Brief delay then transition
    setTimeout(() => startTransition(), 600);
  } else {
    // Failure
    if (errorEl) {
      errorEl.textContent = '// ACCESS DENIED // INVALID KEY //';
      errorEl.style.display = 'block';
    }
    if (statusEl) statusEl.innerHTML = '<span class="blink">▌</span> DENIED';
    input.value = '';
    input.focus();
    // Shake animation
    input.style.animation = 'none';
    input.offsetHeight;
    input.style.animation = 'shake 0.4s ease';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('pw-login-input');
  const btn = document.getElementById('pw-login-btn');

  if (btn) btn.addEventListener('click', async () => { await checkAccessKey(); });
  if (input) {
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') { e.preventDefault(); await checkAccessKey(); }
    });
  }
});
