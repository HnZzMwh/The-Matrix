// ============================================================
// SESSIONS — Save, Load, Export/Import
// ============================================================

function saveSession() {
  if (!currentAgentId) { showToast('SELECT AN AGENT FIRST'); return; }
  const msgs = getAgentMessages(currentAgentId);
  if (msgs.length === 0) { showToast('NO MESSAGES TO SAVE'); return; }
  const ag = agents.find(a => a.id === currentAgentId);
  const allSess = JSON.parse(localStorage.getItem('matrix_sessions_v2') || '[]');
  const firstUser = msgs.find(m => m.role === 'user');
  let title = 'SESSION_' + Date.now();
  if (firstUser && firstUser.text) title = firstUser.text.length > 28 ? firstUser.text.slice(0,28).toUpperCase()+'...' : firstUser.text.toUpperCase();
  const session = {
    id: 'sess_' + Date.now(), agentId: currentAgentId,
    agentName: ag?.name || 'UNKNOWN', title,
    messages: [...msgs], savedAt: Date.now()
  };
  allSess.unshift(session);
  localStorage.setItem('matrix_sessions_v2', JSON.stringify(allSess.slice(0, 30)));
  renderSessionsRight();
  showToast('SESSION SAVED');
}

function renderSessionsRight() {
  const list = document.getElementById('session-list');
  if (!list) return;
  const allSess = JSON.parse(localStorage.getItem('matrix_sessions_v2') || '[]');
  let html = '';
  html += '<div class="new-chat-btn" onclick="startNewChat()">NEW CHAT</div>';
  if (allSess.length === 0) {
    html += '<div class="sessions-empty">// NO SAVED SESSIONS //</div>';
  } else {
    allSess.forEach(s => {
      html += `
        <div class="session-item" onclick="loadAgentSession('${s.id}')">
          <div class="session-agent-tag">${s.agentName || ''}</div>
          <div class="session-title">${escapeHtml(s.title)}</div>
          <div class="session-date">${s.savedAt ? formatTime(s.savedAt) : ''}</div>
        </div>
      `;
    });
  }
  list.innerHTML = html;
}

function startNewChat() {
  if (!currentAgentId) {
    if (agents.length === 0) { showToast('// NO AGENTS AVAILABLE //'); return; }
    selectAgent(agents[0].id);
  }
  saveCurrentAgentChat();
  startNewAgentChat(currentAgentId);
  showToast('// NEW CHAT INITIALIZED //');
}

function loadAgentSession(id) {
  const allSess = JSON.parse(localStorage.getItem('matrix_sessions_v2') || '[]');
  const sess = allSess.find(s => s.id === id);
  if (!sess) return;
  selectAgent(sess.agentId);
  setAgentMessages(sess.agentId, [...sess.messages]);
  renderAgentChat(sess.agentId);
  showToast('SESSION LOADED: ' + sess.title);
}

function loadSessions() { renderSessionsRight(); document.getElementById('saved-panel').classList.add('active'); }

// ─── DATA EXPORT / IMPORT ───────────────────────────────────────
function exportData() {
  const data = {
    agents: JSON.parse(localStorage.getItem('matrix_agents_v2') || '[]'),
    sessions: JSON.parse(localStorage.getItem('matrix_sessions_v2') || '[]'),
    config: JSON.parse(localStorage.getItem('matrix_api_config') || '{}'),
    chats: {}
  };
  data.agents.forEach(ag => {
    const chat = localStorage.getItem('chat_' + ag.id);
    if (chat) data.chats[ag.id] = JSON.parse(chat);
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'matrix_data_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('// DATA EXPORTED //');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.agents) {
        localStorage.setItem('matrix_agents_v2', JSON.stringify(data.agents));
        agents = JSON.parse(JSON.stringify(data.agents));
      }
      if (data.sessions) localStorage.setItem('matrix_sessions_v2', JSON.stringify(data.sessions));
      if (data.config) localStorage.setItem('matrix_api_config', JSON.stringify(data.config));
      if (data.chats) {
        Object.keys(data.chats).forEach(id => {
          localStorage.setItem('chat_' + id, JSON.stringify(data.chats[id]));
        });
      }
      initAgents();
      renderSessionsRight();
      showToast('// DATA IMPORTED //');
    } catch (err) {
      showToast('// IMPORT FAILED: ' + err.message.slice(0,40) + ' //');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('save-btn').addEventListener('click', saveSession);
  document.getElementById('load-btn').addEventListener('click', loadSessions);
  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('saved-panel').classList.remove('active');
  });
});
