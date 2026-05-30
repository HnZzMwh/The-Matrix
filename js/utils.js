// ============================================================
// UTILITIES — Shared helper functions
// ============================================================

// ─── TOAST ───
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }); }
function timeAgo(ts) { const d=Date.now()-ts; if(d<60000)return'JUST NOW'; if(d<3600000)return Math.floor(d/60000)+'M AGO'; if(d<86400000)return Math.floor(d/3600000)+'H AGO'; return Math.floor(d/86400000)+'D AGO'; }
