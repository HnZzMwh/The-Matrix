// ============================================================
// SESSION WIZARD — New session modal with workspace picker
// ============================================================

const WS_PATHS_KEY = 'matrix_workspace_paths';
let swBrowsePath = 'C:\\';

// ─── Workspace paths management ────────────────────────────
function getWorkspacePaths() {
  try { return JSON.parse(localStorage.getItem(WS_PATHS_KEY) || '[]'); }
  catch (e) { return []; }
}

function saveWorkspacePaths(list) {
  localStorage.setItem(WS_PATHS_KEY, JSON.stringify(list));
}

function addWorkspacePath(path) {
  const list = getWorkspacePaths();
  const normalized = path.replace(/\\+$/, '');
  if (!list.includes(normalized)) {
    list.unshift(normalized);
    saveWorkspacePaths(list.slice(0, 20));
  }
}

// ─── Wizard browse ─────────────────────────────────────────
async function swBrowseDirectory(path, recursive) {
  swBrowsePath = path;
  const el = document.getElementById('sw-dir-contents');
  if (!el) return;
  el.innerHTML = '<div class="sw-loading">Scanning...</div>';

  try {
    const ea = window.electronAPI;
    if (!ea) { el.innerHTML = '<div class="sw-empty">No file access available.</div>'; return; }
    const data = await ea.fs.list(path, !!recursive);
    if (!Array.isArray(data)) { el.innerHTML = '<div class="sw-empty">Cannot access path.</div>'; return; }

    let html = '';
    const isDriveRoot = !path || /^[A-Za-z]:\\?$/.test(path);

    // Parent navigation (not at drive listing)
    if (path && !isDriveRoot) {
      const parts = path.replace(/\\+$/, '').split('\\');
      parts.pop();
      const parent = parts.join('\\') + '\\';
      const ap = escapeHtml(parent).replace(/"/g, '&quot;');
      html += `<div class="sw-entry" data-path="${ap}" data-action="nav"><span class="sw-entry-icon">▸</span><span class="sw-entry-name">..</span></div>`;
    }

    if (recursive) {
      for (const e of data) {
        if (e.type !== 'dir') continue;
        const dp = e.path || e.name;
        const ap = escapeHtml(dp).replace(/"/g, '&quot;');
        html += `<div class="sw-entry sw-folder-nav" data-path="${ap}" data-action="nav">
          <span class="sw-entry-icon">▸</span>
          <span class="sw-entry-name">${escapeHtml(e.name)}</span>
          <button class="sw-select-btn" data-path="${ap}" data-action="select">[SELECT]</button>
        </div>`;
      }
    } else {
      for (const e of data) {
        const isDir = e.type === 'dir' || e.type === 'drive';
        const dp = e.path || e.name;
        const icon = e.type === 'drive' ? '▣' : '▸';
        const ap = escapeHtml(dp).replace(/"/g, '&quot;');
        html += `<div class="sw-entry" data-path="${ap}" data-action="${isDir ? 'nav' : ''}">
          <span class="sw-entry-icon">${icon}</span>
          <span class="sw-entry-name">${escapeHtml(isDir ? e.name + '\\' : e.name)}</span>
          ${isDir ? `<button class="sw-select-btn" data-path="${ap}" data-action="select">[SELECT]</button>` : ''}
        </div>`;
      }
      // "Show all subfolders" option
      html += `<div class="sw-entry" style="border-top:1px solid #061a08;margin-top:4px;padding-top:4px">
        <span class="sw-entry-name" data-path="${escapeHtml(path).replace(/"/g,'&quot;')}" data-action="recursive" style="color:#006622;font-size:8px;cursor:pointer">>> SHOW ALL SUBFOLDERS</span>
      </div>`;
    }

    if (!html) html = '<div class="sw-empty">(empty)</div>';
    el.innerHTML = html;
    document.getElementById('sw-path-input').value = path;

  } catch (e) {
    el.innerHTML = '<div class="sw-empty">Error: ' + escapeHtml(e.message || '') + '</div>';
  }
}

function selectWorkspacePath(path) {
  document.getElementById('sw-selected-path').textContent = path;
  document.getElementById('sw-selected').style.display = 'flex';
  document.getElementById('sw-confirm-btn').dataset.path = path;
}

// ─── Open / Close ──────────────────────────────────────────
function openSessionWizard() {
  document.getElementById('session-wizard').classList.add('active');
  // Update wizard title based on current mode
  const mode = (typeof getCurrentMode === 'function') ? getCurrentMode() : 'chat';
  const hdr = document.querySelector('#session-wizard .sw-hdr h3');
  if (hdr) hdr.textContent = mode === 'code' ? '// NEW SESSION //' : '// NEW CHAT //';
  swBrowseDirectory(swBrowsePath);
  document.getElementById('sw-selected').style.display = 'none';
}

function closeSessionWizard() {
  document.getElementById('session-wizard').classList.remove('active');
}

// ─── Start sessions ────────────────────────────────────────
async function startConversationSession() {
  closeSessionWizard();
  await maybeAutoSaveCurrentSession();
  const agentId = currentAgentId || (agents[0] && agents[0].id);
  if (!agentId) { showToast('// NO AGENT AVAILABLE //'); return; }
  if (typeof startFreshSession === 'function') {
    startFreshSession(agentId, null);
  }
  if (typeof hydrateAgentStatesFromCurrentSession === 'function') {
    hydrateAgentStatesFromCurrentSession();
  }
  // Select agent to ensure UI is correct
  if (typeof selectAgent === 'function') selectAgent(agentId);
  // Immediately persist empty session to saved list so it appears in panel
  saveCurrentToSessionList();
  renderSessionsRight();
  showToast('// NEW CONVERSATION //');
}

async function startWorkspaceSession(path) {
  if (!path) return;
  closeSessionWizard();
  addWorkspacePath(path);
  await maybeAutoSaveCurrentSession();
  const agentId = currentAgentId || (agents[0] && agents[0].id);
  if (!agentId) { showToast('// NO AGENT AVAILABLE //'); return; }
  if (typeof startFreshSession === 'function') {
    startFreshSession(agentId, path);
  }
  if (typeof hydrateAgentStatesFromCurrentSession === 'function') {
    hydrateAgentStatesFromCurrentSession();
  }
  if (typeof selectAgent === 'function') selectAgent(agentId);
  // Immediately persist empty session to saved list so it appears in panel
  saveCurrentToSessionList();
  renderSessionsRight();
  const name = path.split('\\').pop() || path;
  showToast('// NEW WORKSPACE: ' + name + ' //');
}

// ─── Save current (empty) session to the saved list ──────────
function saveCurrentToSessionList() {
  const current = (typeof getCurrentSession === 'function') ? getCurrentSession() : null;
  if (!current) return;
  const key = (typeof SAVED_SESSIONS_KEY !== 'undefined') ? SAVED_SESSIONS_KEY : 'matrix_sessions_v3';
  const legacyKey = 'matrix_sessions_v2';
  let raw = localStorage.getItem(key);
  if (!raw) raw = localStorage.getItem(legacyKey);
  const saved = JSON.parse(raw || '[]');
  // Avoid duplicates
  if (!saved.some(s => s.id === current.id)) {
    saved.unshift(current);
    localStorage.setItem(key, JSON.stringify(saved.slice(0, 30)));
  }
}

// ─── Event bindings ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const wizard = document.getElementById('session-wizard');
  if (!wizard) return;

  // Delegated click handler for browse entries
  wizard.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const path = target.dataset.path || target.parentElement?.dataset?.path;

    if (action === 'nav') {
      swBrowseDirectory(path);
    } else if (action === 'select') {
      selectWorkspacePath(path);
    } else if (action === 'recursive') {
      swBrowseDirectory(path || swBrowsePath, true);
    }
  });

  // GO button
  document.getElementById('sw-go-btn')?.addEventListener('click', () => {
    const input = document.getElementById('sw-path-input');
    if (input && input.value.trim()) swBrowseDirectory(input.value.trim());
  });

  // Path input Enter
  document.getElementById('sw-path-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      swBrowseDirectory(document.getElementById('sw-path-input').value.trim());
    }
  });

  // Conversation button
  document.getElementById('sw-conv-btn')?.addEventListener('click', startConversationSession);

  // Confirm workspace button
  document.getElementById('sw-confirm-btn')?.addEventListener('click', () => {
    const path = document.getElementById('sw-confirm-btn').dataset.path;
    if (path) startWorkspaceSession(path);
  });

  // Close button
  document.getElementById('sw-close-btn')?.addEventListener('click', closeSessionWizard);
});
