// ============================================================
// TRANSITION OVERLAY ANIMATION
// ============================================================

const TRANS_MESSAGES = [
  'Host is entering the Matrix...',
  'Initializing status...',
  'Uploading personal self-avatar...',
  'Neural link established...',
  'Rendering Matrix skin...',
  'Access successful // CONNECTED',
];

function startTransition() {
  stopFaceScan();
  document.getElementById('upload-screen').classList.remove('active');
  const overlay = document.getElementById('transition-overlay');
  overlay.classList.add('active');

  let msgIdx = 0;
  let prog = 0;

  const msgEl = document.getElementById('tr-text1');
  const progEl = document.getElementById('tr-progress');
  const extraEl = document.getElementById('tr-extra');

  const msgInterval = setInterval(() => {
    if (msgIdx < TRANS_MESSAGES.length) {
      msgEl.style.animation = 'none';
      msgEl.offsetHeight;
      msgEl.style.animation = 'fadeInOut 1.5s ease-in-out forwards';
      msgEl.textContent = TRANS_MESSAGES[msgIdx++];
      extraEl.textContent = randGlitch(40);
    }
  }, 1500);

  const progInterval = setInterval(() => {
    const remaining = 100 - prog;
    const increment = Math.max(0.5, remaining * (0.03 + Math.random() * 0.05));
    prog = Math.min(99.5, prog + increment);
    progEl.style.width = prog + '%';
    if (prog > 82 && Math.random() < 0.12) {
      clearInterval(progInterval);
      setTimeout(() => {
        const finishInterval = setInterval(() => {
          const r2 = 100 - prog;
          prog = Math.min(100, prog + Math.max(0.8, r2 * (0.04 + Math.random() * 0.06)));
          progEl.style.width = prog + '%';
          if (prog >= 100) {
            prog = 100;
            progEl.style.width = '100%';
            clearInterval(finishInterval);
            clearInterval(msgInterval);
            setTimeout(() => {
              overlay.classList.remove('active');
              enterWhiteRoom();
            }, 600);
          }
        }, 120);
      }, 600 + Math.random() * 800);
    }
    if (prog >= 100) {
      prog = 100;
      clearInterval(progInterval);
      clearInterval(msgInterval);
      setTimeout(() => {
        overlay.classList.remove('active');
        enterWhiteRoom();
      }, 600);
    }
  }, 200);
}
