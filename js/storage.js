// ============================================================
// STORAGE — IndexedDB for chat messages (large capacity)
// ============================================================

const DB_NAME = 'matrix_chat_db';
const DB_VERSION = 1;
const STORE_NAME = 'chats';

let dbPromise = null;

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

// Save chat messages for an agent (IndexedDB)
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

// Load chat messages for an agent (IndexedDB)
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

// Delete chat for an agent
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

// ─── Unified API ───

async function saveChat(agentId, messages) {
  // Try IndexedDB first
  const ok = await idbSaveChat(agentId, messages);
  if (ok) return true;
  // Fallback: localStorage with trimming
  try {
    const trimmed = messages.slice(-50); // keep last 50 messages
    localStorage.setItem('chat_' + agentId, JSON.stringify(trimmed));
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      showToast('// STORAGE FULL! EXPORT DATA OR DELETE OLD SESSIONS //');
    }
    return false;
  }
}

async function loadChat(agentId) {
  // Try IndexedDB first
  const idbResult = await idbLoadChat(agentId);
  if (idbResult !== null) return idbResult;
  // Fallback: localStorage
  try {
    const raw = localStorage.getItem('chat_' + agentId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function deleteChat(agentId) {
  idbDeleteChat(agentId);
  localStorage.removeItem('chat_' + agentId);
}

// Migration helper: move existing localStorage chats to IndexedDB
async function migrateLocalStorageToIndexedDB() {
  const agentsRaw = localStorage.getItem('matrix_agents_v2');
  if (!agentsRaw) return;
  let migrated = 0;
  try {
    const agents = JSON.parse(agentsRaw);
    for (const ag of agents) {
      const raw = localStorage.getItem('chat_' + ag.id);
      if (raw) {
        const msgs = JSON.parse(raw);
        const saved = await idbSaveChat(ag.id, msgs);
        if (saved) {
          localStorage.removeItem('chat_' + ag.id);
          migrated++;
        }
      }
    }
    if (migrated > 0) {
      console.log(`Migrated ${migrated} chats from localStorage to IndexedDB`);
    }
  } catch (e) {
    console.warn('Migration error:', e);
  }
}

// ─── AVATAR COMPRESSION ─────────────────────────────────────

function compressAvatar(dataUrl, size = 80, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // crop to square center
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback
    img.src = dataUrl;
  });
}

async function generateTaskAvatar(normalDataUrl) {
  if (!normalDataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 80;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Draw the normal avatar centered-square-cropped
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

      // Green tint over entire image
      const imageData = ctx.getImageData(0, 0, size, size);
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i]   = imageData.data[i] * 0.25;      // R → reduce
        imageData.data[i+1] = imageData.data[i+1] * 0.5 + 60; // G → amplify
        imageData.data[i+2] = imageData.data[i+2] * 0.2;      // B → reduce
      }
      ctx.putImageData(imageData, 0, 0);

      // Draw scanlines
      for (let y = 0; y < size; y += 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y, size, 1);
      }

      // Green glow border
      ctx.strokeStyle = 'rgba(0,255,65,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);

      // Corner brackets
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 1.5;
      const cl = 12;
      ctx.beginPath();
      ctx.moveTo(0, cl); ctx.lineTo(0, 0); ctx.lineTo(cl, 0);
      ctx.moveTo(size - cl, 0); ctx.lineTo(size, 0); ctx.lineTo(size, cl);
      ctx.moveTo(size, size - cl); ctx.lineTo(size, size); ctx.lineTo(size - cl, size);
      ctx.moveTo(cl, size); ctx.lineTo(0, size); ctx.lineTo(0, size - cl);
      ctx.stroke();

      resolve(canvas.toDataURL('image/jpeg', 0.7));
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
      // Compress oversized normal avatar
      if (ag.avatar && ag.avatar.length > 5000) {
        const compressed = await compressAvatar(ag.avatar);
        if (compressed !== ag.avatar) {
          ag.avatar = compressed;
          changed = true;
        }
      }
      // Generate task avatar if missing but normal avatar exists
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
