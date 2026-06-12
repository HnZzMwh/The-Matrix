// ============================================================
// HISTORY — Operation audit log & workspace snapshot system
// ============================================================

const HIST_DB_NAME = 'matrix_history_db';
const HIST_DB_VER = 1;
let histDB = null;

function openHistDB() {
  if (histDB) return Promise.resolve(histDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HIST_DB_NAME, HIST_DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('history')) {
        const hs = db.createObjectStore('history', { keyPath: 'id' });
        hs.createIndex('timestamp', 'timestamp', { unique: false });
        hs.createIndex('agentId', 'agentId', { unique: false });
        hs.createIndex('toolName', 'toolName', { unique: false });
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        const ss = db.createObjectStore('snapshots', { keyPath: 'id' });
        ss.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = (e) => { histDB = e.target.result; resolve(histDB); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function histTx(store, mode) {
  return openHistDB().then(db => db.transaction(store, mode).objectStore(store));
}

// ─── Log an operation ───────────────────────────────────────
async function logOperation(entry) {
  try {
    const st = await histTx('history', 'readwrite');
    st.add(entry);
  } catch (e) {
    // Silently fail — history is non-critical
  }
}

// ─── Create a snapshot ──────────────────────────────────────
async function createSnapshot(label, agentId, agentName) {
  const files = {};
  WORKSPACE._init();
  Object.assign(files, WORKSPACE.files);

  const snap = {
    id: 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    label: label || 'Auto-snapshot',
    timestamp: Date.now(),
    agentId: agentId || 'system',
    agentName: agentName || 'SYSTEM',
    files: JSON.parse(JSON.stringify(files)),
  };

  try {
    const st = await histTx('snapshots', 'readwrite');
    st.add(snap);
  } catch (e) {}
  return snap;
}

// ─── Restore a snapshot ─────────────────────────────────────
async function restoreSnapshot(snapId) {
  let snap;
  try {
    const st = await histTx('snapshots', 'readonly');
    snap = await new Promise((resolve, reject) => {
      const req = st.get(snapId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = reject;
    });
  } catch (e) {
    return `// ERROR: Failed to load snapshot ${snapId}`;
  }
  if (!snap) return `// ERROR: Snapshot ${snapId} not found`;

  // Restore all files from snapshot
  WORKSPACE._init();
  WORKSPACE.files = JSON.parse(JSON.stringify(snap.files));

  return `// ✅ Restored snapshot "${snap.label}" from ${new Date(snap.timestamp).toLocaleString()}
// ${Object.keys(snap.files).length} files restored.`;
}

// ─── List snapshots ─────────────────────────────────────────
async function listSnapshots() {
  try {
    const st = await histTx('snapshots', 'readonly');
    const all = await new Promise((resolve, reject) => {
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = reject;
    });
    all.sort((a, b) => b.timestamp - a.timestamp);
    if (all.length === 0) return '// No snapshots saved yet.';
    return `📦 Snapshots (${all.length}):\n` +
      all.map(s => `  [${new Date(s.timestamp).toLocaleTimeString()}] ${s.id}: ${s.label} (by ${s.agentName})`).join('\n');
  } catch (e) {
    return '// Unable to load snapshots';
  }
}

// ─── Load history ───────────────────────────────────────────
async function loadHistory(limit = 50) {
  try {
    const st = await histTx('history', 'readonly');
    const idx = st.index('timestamp');
    const all = await new Promise((resolve, reject) => {
      const req = idx.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = reject;
    });
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, limit);
  } catch (e) {
    return [];
  }
}

// ─── Tool-call wrapper: logs every tool execution ──────────
async function loggedToolCall(agentId, agentName, toolName, toolParams, resultStr) {
  const entry = {
    id: 'hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    agentId: agentId || 'unknown',
    agentName: agentName || 'UNKNOWN',
    toolName,
    toolParams: JSON.stringify(toolParams),
    filePath: toolParams.path || toolParams.file || toolParams.name || '',
    result: (resultStr || '').slice(0, 500),
  };

  // For write operations, save content before and after
  if (toolName === 'write_file' && toolParams.path) {
    WORKSPACE._init();
    const prev = WORKSPACE.files[toolParams.path] || '';
    entry.contentBefore = prev.slice(0, 300);
    entry.contentAfter = (toolParams.content || '').slice(0, 300);

    // Auto-snapshot before first write in this session
    const existingSnaps = await listSnapshotsRaw();
    if (existingSnaps.length === 0 || !existingSnaps.some(s => s.label === 'Auto-snapshot')) {
      const autoSnap = await createSnapshot('Auto-snapshot', agentId, agentName);
      entry.snapshotId = autoSnap.id;
    }
  }
  if (toolName === 'delete_file' && toolParams.path) {
    WORKSPACE._init();
    entry.contentBefore = (WORKSPACE.files[toolParams.path] || '').slice(0, 300);
  }

  await logOperation(entry);
  return entry;
}

async function listSnapshotsRaw() {
  try {
    const st = await histTx('snapshots', 'readonly');
    return await new Promise((resolve, reject) => {
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = reject;
    });
  } catch { return []; }
}

// ─── Get trimmed diff for display ──────────────────────────
function formatDiff(before, after) {
  if (!before && !after) return '(empty)';
  if (!before) return `[NEW FILE]\n${after}`;
  if (!after) return `[DELETED]\n${before}`;
  const bLines = before.split('\n');
  const aLines = after.split('\n');
  let diff = '';
  const maxLines = 8;
  for (let i = 0; i < Math.min(bLines.length, aLines.length, maxLines); i++) {
    if (bLines[i] !== aLines[i]) {
      diff += `- ${bLines[i]}\n+ ${aLines[i]}\n`;
    }
  }
  if (bLines.length !== aLines.length) {
    diff += `... (${bLines.length} → ${aLines.length} lines)`;
  }
  return diff || '(content unchanged)';
}

// ─── UI: render history panel ──────────────────────────────
async function renderHistory() {
  const list = document.getElementById('hist-list');
  if (!list) return;
  const filter = (document.getElementById('hist-search')?.value || '').toLowerCase();
  const entries = await loadHistory(100);
  const filtered = filter ? entries.filter(e =>
    e.agentName.toLowerCase().includes(filter) ||
    e.toolName.toLowerCase().includes(filter) ||
    (e.filePath || '').toLowerCase().includes(filter)
  ) : entries;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="hist-empty">// NO OPERATIONS RECORDED //</div>';
    return;
  }
  list.innerHTML = filtered.map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const hasDiff = e.contentBefore !== undefined;
    return `<div class="hist-entry">
      <div class="hist-entry-hdr">
        <span class="hist-time">${time}</span>
        <span class="hist-agent">${escapeHtml(e.agentName)}</span>
        <span class="hist-tool">${escapeHtml(e.toolName)}</span>
        <span class="hist-file">${escapeHtml(e.filePath || '')}</span>
      </div>
      <div class="hist-entry-body" style="display:none">
        <div class="hist-result">${escapeHtml(e.result || '').slice(0, 200)}</div>
        ${hasDiff ? `<div class="hist-diff">${escapeHtml(formatDiff(e.contentBefore, e.contentAfter))}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Click to expand/collapse
  list.querySelectorAll('.hist-entry-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling;
      if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });
  });
}

async function renderSnapshots() {
  const list = document.getElementById('snap-list');
  if (!list) return;
  const snaps = await listSnapshotsRaw();
  snaps.sort((a, b) => b.timestamp - a.timestamp);

  if (snaps.length === 0) {
    list.innerHTML = '<div class="hist-empty">// NO CHECKPOINTS YET //</div>';
    return;
  }
  list.innerHTML = snaps.map(s => {
    const time = new Date(s.timestamp).toLocaleString();
    return `<div class="snap-entry">
      <div class="snap-info">
        <span class="snap-label">${escapeHtml(s.label)}</span>
        <span class="snap-time">${time}</span>
        <span class="snap-agent">by ${escapeHtml(s.agentName)}</span>
        <span class="snap-files">${Object.keys(s.files).length} files</span>
      </div>
      <div class="snap-actions">
        <button class="btn-snap-restore" data-id="${s.id}" data-label="${escapeHtml(s.label)}">[ RESTORE ]</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.btn-snap-restore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const label = btn.dataset.label;
      if (!confirm(`Restore snapshot "${label}"? Current workspace will be replaced.`)) return;
      const result = await restoreSnapshot(id);
      showToast('// RESTORED: ' + label + ' //');
      renderSnapshots();
      // If viewing a chat, show a system message
      if (currentAgentId) {
        const st = ensureState(currentAgentId);
        st.messages.push({ role: 'system', text: result, time: Date.now() });
        renderAgentChat(currentAgentId);
        saveChat(currentAgentId, st.messages);
      }
    });
  });
}

// ─── UI: init events ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('history-panel');
  if (!panel) return;

  document.getElementById('log-toggle-btn').addEventListener('click', () => {
    panel.classList.toggle('active');
    if (panel.classList.contains('active')) {
      renderHistory();
      renderSnapshots();
    }
  });

  // Tab switching
  panel.querySelectorAll('.hist-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.hist-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.hist-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const target = document.getElementById('hist-' + tab.dataset.tab);
      if (target) target.style.display = 'block';
    });
  });

  // Search filter
  document.getElementById('hist-search')?.addEventListener('input', renderHistory);
  document.getElementById('hist-refresh')?.addEventListener('click', renderHistory);

  // Manual checkpoint
  document.getElementById('snap-manual-btn')?.addEventListener('click', async () => {
    const label = prompt('Checkpoint name:', `Checkpoint ${new Date().toLocaleTimeString()}`);
    if (!label) return;
    const snap = await createSnapshot(label, 'user', 'USER');
    showToast('// CHECKPOINT SAVED: ' + label + ' //');
    renderSnapshots();
  });
  document.getElementById('snap-refresh-btn')?.addEventListener('click', renderSnapshots);
});
