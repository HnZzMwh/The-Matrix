const { contextBridge, ipcRenderer, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

// ── Synchronous store cache (pre-load all .json files) ──
const DATA_DIR = path.join(__dirname, 'renderer', 'data');
const CHAT_DIR = path.join(DATA_DIR, 'chat');
const CHAT_HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const storeCache = {};
try {
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const key = path.basename(file, '.json');
        try {
          const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
          storeCache[key] = JSON.parse(raw);
        } catch (e) { /* skip corrupted files */ }
      }
    }
  }
  // Load most recent chat file per agent from chat_history/{agentId}/
  if (fs.existsSync(CHAT_HISTORY_DIR)) {
    const agentDirs = fs.readdirSync(CHAT_HISTORY_DIR, { withFileTypes: true });
    for (const ent of agentDirs) {
      if (!ent.isDirectory()) continue;
      const agentId = ent.name;
      const agentDir = path.join(CHAT_HISTORY_DIR, agentId);
      const chatFiles = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
      if (chatFiles.length > 0) {
        chatFiles.sort().reverse();
        try {
          const raw = fs.readFileSync(path.join(agentDir, chatFiles[0]), 'utf-8');
          storeCache['chat_' + agentId] = JSON.parse(raw);
        } catch (e) { /* skip corrupted files */ }
      }
    }
  }
} catch (e) { /* data dir not available */ }

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  storeCache: storeCache, // synchronous pre-loaded cache

  // ── Storage (replaces localStorage + IndexedDB) ─────────
  store: {
    getAll:        ()           => ipcRenderer.invoke('store:getAll'),
    get:           (key)        => ipcRenderer.invoke('store:get', key),
    set:           (key, data)  => ipcRenderer.invoke('store:set', key, data),
    remove:        (key)        => ipcRenderer.invoke('store:remove', key),
    getChat:       (id)         => ipcRenderer.invoke('store:getChat', id),
    setChat:       (id, data)   => ipcRenderer.invoke('store:setChat', id, data),
    deleteChat:    (id)         => ipcRenderer.invoke('store:deleteChat', id),
    getChatFiles:  (id)         => ipcRenderer.invoke('store:getChatFiles', id),
    saveChatFile:  (id, fn, d)  => ipcRenderer.invoke('store:saveChatFile', id, fn, d),
    getChatFile:   (id, fn)     => ipcRenderer.invoke('store:getChatFile', id, fn),
    deleteChatDir: (id)         => ipcRenderer.invoke('store:deleteChatDir', id),
    getHistory:    ()           => ipcRenderer.invoke('store:getHistory'),
    saveHistory:   (data)       => ipcRenderer.invoke('store:saveHistory', data),
    getArchitecture: ()         => ipcRenderer.invoke('store:getArchitecture'),
    saveArchitecture: (data)    => ipcRenderer.invoke('store:saveArchitecture', data),
  },

  // ── File System (replaces server.py) ────────────────────
  fs: {
    read:    (p)       => ipcRenderer.invoke('fs:read', p),
    write:   (p, c)    => ipcRenderer.invoke('fs:write', p, c),
    list:    (p, r)    => ipcRenderer.invoke('fs:list', p, r),
    search:  (q, r)    => ipcRenderer.invoke('fs:search', q, r),
    run:     (c, w,cap)=> ipcRenderer.invoke('fs:run', c, w, cap),
  },

  // ── Window ──────────────────────────────────────────────
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    close:    () => ipcRenderer.invoke('win:close'),
    toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  },

  clipboard: {
    writeText: (text) => clipboard.writeText(String(text || '')),
  },

  // ── LangGraph Engine (Python sidecar) ────────────────
  lg: {
    getStatus:  ()       => ipcRenderer.invoke('lg:status'),
    run:        (data)   => ipcRenderer.invoke('lg:run', data),
    memoryStore:(data)   => ipcRenderer.invoke('lg:memoryStore', data),
    memoryQuery:(q,k)    => ipcRenderer.invoke('lg:memoryQuery', q, k),
    sessionList:()       => ipcRenderer.invoke('lg:sessionList'),
  },
});
