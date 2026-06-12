// ============================================================
// STORAGE — IndexedDB for chat messages (large capacity)
// Plus auto-sync to disk for persistence across reloads
// ============================================================

const DB_NAME = 'matrix_chat_db';
const DB_VERSION = 1;
const STORE_NAME = 'chats';
const CURRENT_SESSION_KEY = 'matrix_current_session_v1';
const SAVED_SESSIONS_KEY = 'matrix_sessions_v3';
const MAX_STORED_MESSAGES = 100; // Max non-system messages to keep per agent

let dbPromise = null;
let currentSession = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

async function idbSaveChat(agentId, messages) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(messages, agentId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
    return true;
  } catch (e) {
    console.warn('IndexedDB save failed, falling back to localStorage:', e);
    return false;
  }
}

async function idbLoadChat(agentId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(agentId);
    const result = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return result || [];
  } catch (e) {
    console.warn('IndexedDB load failed:', e);
    return null;
  }
}

async function idbDeleteChat(agentId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(agentId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch (e) {
    console.warn('IndexedDB delete failed:', e);
  }
}

const chatFilenames = {};

function nextChatFilename(agentId) {
  const ts = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  return ts + '.json';
}

function getEA() {
  return (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;
}

function getCurrentSession() {
  return currentSession;
}

async function persistCurrentSession() {
  if (!currentSession) return false;
  try {
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(currentSession));
  } catch (e) {
    console.warn('Current session localStorage save failed:', e);
  }
  const ea = getEA();
  if (ea && ea.store && ea.store.set) {
    try {
      await ea.store.set('current_session', currentSession);
    } catch (e) {
      console.warn('Current session disk save failed:', e);
    }
  }
  return true;
}

async function loadCurrentSessionFromStore() {
  try {
    const raw = localStorage.getItem(CURRENT_SESSION_KEY);
    if (raw) return SessionModel.normalizeSavedSession(JSON.parse(raw));
  } catch (e) {
    console.warn('Current session localStorage load failed:', e);
  }
  const ea = getEA();
  if (ea && ea.store && ea.store.get) {
    try {
      const disk = await ea.store.get('current_session');
      if (disk) return SessionModel.normalizeSavedSession(disk);
    } catch (e) {
      console.warn('Current session disk load failed:', e);
    }
  }
  return null;
}

function collectLegacyChats(agentsList) {
  const legacyChats = {};

  // Strategy 1: Collect from known agents in the list
  (agentsList || []).forEach(agent => {
    try {
      const raw = localStorage.getItem('chat_' + agent.id);
      if (raw) {
        const parsed = JSON.parse(raw);
        legacyChats[agent.id] = Array.isArray(parsed) ? parsed : [];
        return;
      }
    } catch (e) { /* ignore malformed legacy localStorage */ }
    legacyChats[agent.id] = [];
  });

  // Strategy 2: Discover orphaned chat keys that don't belong to any known agent.
  // This catches history from deleted agents or agents that weren't loaded yet.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('chat_') && !legacyChats[key.slice(5)]) {
        const agentId = key.slice(5);
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              legacyChats[agentId] = parsed;
            }
          }
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore localStorage iteration errors */ }

  return legacyChats;
}

async function initCurrentSession(agentsList, activeAgentId) {
  currentSession = await loadCurrentSessionFromStore();
  if (!currentSession) {
    const legacyChats = collectLegacyChats(agentsList || []);
    currentSession = SessionModel.migrateLegacyRuntimeChats(
      legacyChats,
      agentsList || [],
      activeAgentId || null
    );
    await persistCurrentSession();
  }
  return currentSession;
}

function replaceCurrentSession(nextSession) {
  currentSession = SessionModel.normalizeSavedSession(nextSession);
  if (currentSession) currentSession.dirty = false;
  return persistCurrentSession();
}

function hydrateAgentStatesFromCurrentSession() {
  const session = getCurrentSession();
  if (typeof agents === 'undefined' || !Array.isArray(agents)) return;
  if (typeof ensureState !== 'function') return;
  agents.forEach(agent => {
    const st = ensureState(agent.id);
    const bucket = session && session.agents ? session.agents[agent.id] : null;
    st.messages = bucket ? [...bucket.messages] : [];
    st.isThinking = false;
    st.typing = null;
    st.status = '';
  });
}

function startFreshSession(activeAgentId, folderPath) {
  currentSession = SessionModel.createEmptySession({
    id: 'sess_' + Date.now(),
    currentAgentId: activeAgentId || null,
    now: Date.now(),
  });
  currentSession.folderPath = folderPath || null;
  currentSession.mode = folderPath ? 'code' : 'chat';
  persistCurrentSession();
}

// ─── Save session-backed chat state ──────────────────────────
async function saveChat(agentId, messages) {
  if (!currentSession || !SessionModel) return false;
  // Preserve system messages (tool instructions, agent prompts) separately from truncation
  const systemMsgs = messages.filter(m => m.role === 'system');
  const recentNonSystem = messages.filter(m => m.role !== 'system').slice(-MAX_STORED_MESSAGES || 100);
  const trimmed = [...systemMsgs, ...recentNonSystem];
  const agent = (typeof agents !== 'undefined' && Array.isArray(agents))
    ? agents.find(a => a.id === agentId)
    : null;
  const bucket = SessionModel.ensureSessionAgent(currentSession, agent || {
    id: agentId,
    name: String(agentId || 'AGENT').toUpperCase(),
  });
  bucket.messages = trimmed;
  currentSession.lastActiveAgentId = (typeof currentAgentId !== 'undefined' && currentAgentId) ? currentAgentId : agentId;
  currentSession.savedAt = SessionModel.getLatestSessionTimestamp(currentSession);
  currentSession.dirty = true;
  return persistCurrentSession();
}

// ─── Load agent messages from current session ─────────────────
async function loadChat(agentId) {
  if (!currentSession) return [];
  const bucket = currentSession.agents && currentSession.agents[agentId];
  return bucket ? [...bucket.messages] : [];
}

function newChatFile(agentId) {
  chatFilenames[agentId] = nextChatFilename(agentId);
}

function deleteChat(agentId) {
  delete chatFilenames[agentId];
  if (currentSession && currentSession.agents && currentSession.agents[agentId]) {
    delete currentSession.agents[agentId];
    currentSession.savedAt = SessionModel.getLatestSessionTimestamp(currentSession);
    currentSession.dirty = true;
    persistCurrentSession();
  }
}

async function migrateLocalStorageToIndexedDB() {
  // Task 6: Demoted legacy migration path
  return 0;
}

// ─── Auto-sync all runtime data to disk ──────────────────────
async function syncRuntimeToDisk() {
  const ea = getEA();
  if (!ea || !ea.store.set) return;

  // 1. Sync agents to disk
  try {
    const agentsData = localStorage.getItem('matrix_agents_v2');
    if (agentsData) {
      await ea.store.set('agents', JSON.parse(agentsData));
    }
  } catch (e) { /* skip */ }

  // 2. Sync config to disk
  try {
    const configData = localStorage.getItem('matrix_api_config');
    if (configData) {
      await ea.store.set('api_config', JSON.parse(configData));
    }
  } catch (e) { /* skip */ }

  // 3. Sync sessions to disk
  try {
    const sessionsData = localStorage.getItem(SAVED_SESSIONS_KEY) || localStorage.getItem('matrix_sessions_v2');
    if (sessionsData) {
      await ea.store.set('sessions', JSON.parse(sessionsData));
    }
  } catch (e) { /* skip */ }

  // 3.5 Sync current session to disk
  try {
    const currentSessionData = localStorage.getItem(CURRENT_SESSION_KEY);
    if (currentSessionData) {
      await ea.store.set('current_session', JSON.parse(currentSessionData));
    }
  } catch (e) { /* skip */ }

  // 4. Sync profiles to disk
  try {
    const profilesData = localStorage.getItem('matrix_api_profiles');
    if (profilesData) {
      await ea.store.set('api_profiles', JSON.parse(profilesData));
    }
  } catch (e) { /* skip */ }

  // 5. Sync whitelist to disk
  try {
    const wlData = localStorage.getItem('matrix_file_whitelist');
    if (wlData) {
      await ea.store.set('file_whitelist', JSON.parse(wlData));
    }
  } catch (e) { /* skip */ }
}

// ─── Periodic auto-sync (every 30 seconds) ──────────────────
let _syncTimer = null;
function startAutoSync() {
  if (_syncTimer) return;
  _syncTimer = setInterval(() => {
    syncRuntimeToDisk();
  }, 30000); // every 30 seconds
}

function stopAutoSync() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
}

// ─── Sync on beforeunload ───────────────────────────────────
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    syncRuntimeToDisk();
  });
}

// ─── AVATAR COMPRESSION ─────────────────────────────────────

function compressAvatar(dataUrl, size = 256, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function generateTaskAvatar(normalDataUrl) {
  if (!normalDataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i]   = imageData.data[i] * 0.25;
        imageData.data[i+1] = imageData.data[i+1] * 0.5 + 60;
        imageData.data[i+2] = imageData.data[i+2] * 0.2;
      }
      ctx.putImageData(imageData, 0, 0);
      for (let y = 0; y < size; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y, size, 1);
      }
      ctx.strokeStyle = 'rgba(0,255,65,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 1.5;
      const cl = 12;
      ctx.beginPath();
      ctx.moveTo(0, cl); ctx.lineTo(0, 0); ctx.lineTo(cl, 0);
      ctx.moveTo(size - cl, 0); ctx.lineTo(size, 0); ctx.lineTo(size, cl);
      ctx.moveTo(size, size - cl); ctx.lineTo(size, size); ctx.lineTo(size - cl, size);
      ctx.moveTo(cl, size); ctx.lineTo(0, size); ctx.lineTo(0, size - cl);
      ctx.stroke();
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(null);
    img.src = normalDataUrl;
  });
}

async function compressAllAvatars() {
  const agentsRaw = localStorage.getItem('matrix_agents_v2');
  if (!agentsRaw) return;
  try {
    const agentsList = JSON.parse(agentsRaw);
    let changed = false;
    for (const ag of agentsList) {
      if (ag.avatar) {
        const img = await new Promise(resolve => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => resolve(null);
          i.src = ag.avatar;
        });
        if (img && (img.width < 200 || img.height < 200)) {
          const compressed = await compressAvatar(ag.avatar, 256, 0.85);
          if (compressed !== ag.avatar) {
            ag.avatar = compressed;
            changed = true;
          }
        }
      }
      if (ag.avatar && !ag.taskAvatar) {
        ag.taskAvatar = await generateTaskAvatar(ag.avatar);
        if (ag.taskAvatar) changed = true;
      }
    }
    if (changed) {
      localStorage.setItem('matrix_agents_v2', JSON.stringify(agentsList));
      if (typeof agents !== 'undefined' && Array.isArray(agents)) {
        agentsList.forEach(ca => {
          const idx = agents.findIndex(a => a.id === ca.id);
          if (idx !== -1) {
            agents[idx].avatar = ca.avatar;
            agents[idx].taskAvatar = ca.taskAvatar;
          }
        });
      }
    }
  } catch (e) {
    console.warn('Avatar compression error:', e);
  }
}

async function recoverChatsFromIndexedDB() {
  // Task 6: Demoted legacy recovery path
  return 0;
}
