const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');

// ══════════════════════════════════════════════════════════════
// DATA DIRECTORY
// ══════════════════════════════════════════════════════════════
const DATA_DIR = app.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(__dirname, 'renderer', 'data');

const CHAT_DIR = path.join(DATA_DIR, 'chat');
const CHAT_HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');

function ensureDirs() {
  [DATA_DIR, CHAT_DIR, CHAT_HISTORY_DIR, SNAP_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function dataFile(name) { return path.join(DATA_DIR, name); }
function chatFile(agentId) { return path.join(CHAT_DIR, agentId + '.json'); }
function agentChatDir(agentId) { const d = path.join(CHAT_HISTORY_DIR, agentId); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d; }
function snapFile(name) { return path.join(SNAP_DIR, name + '.json'); }

// ── Migration: move old chat/*.json to chat_history/{agentId}/ ──
function migrateOldChats() {
  if (!fs.existsSync(CHAT_DIR)) return;
  const files = fs.readdirSync(CHAT_DIR);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const agentId = f.replace('.json', '');
    const oldFp = path.join(CHAT_DIR, f);
    const newDir = agentChatDir(agentId);
    const newFp = path.join(newDir, Date.now() + '.json');
    try {
      // Only migrate if there's no existing file in chat_history
      const existing = fs.readdirSync(newDir).filter(x => x.endsWith('.json'));
      if (existing.length === 0) {
        const data = JSON.parse(fs.readFileSync(oldFp, 'utf8'));
        fs.writeFileSync(newFp, JSON.stringify(data, null, 2));
      }
    } catch(e) {}
  }
}

// ══════════════════════════════════════════════════════════════
// WINDOW
// ══════════════════════════════════════════════════════════════
let win;

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL() && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'matrix-upload.html'));
  if (!app.isPackaged) win.webContents.openDevTools({ mode: 'detach' });
  // Migrate old chat/ files to chat_history/ structure
  migrateOldChats();
}

// ══════════════════════════════════════════════════════════════
// APP LIFECYCLE
// ══════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  ensureDirs();

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media');
  });

  // CSP for MediaPipe WASM + CDN + LLM APIs
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: " +
          "https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com " +
          "https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com; " +
          "connect-src 'self' http://localhost:* https: ws: wss:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob:; " +
          "worker-src 'self' blob:; " +
          "media-src 'self' blob: data:;"
        ]
      }
    });
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

  // LangGraph engine disabled — using local Ollama directly
  // startLangGraphEngine();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ══════════════════════════════════════════════════════════════
// IPC — STORAGE (replaces localStorage + IndexedDB)
// ══════════════════════════════════════════════════════════════

// — Read all data at startup (for localStorage adapter)
ipcMain.handle('store:getAll', async () => {
  const all = {};
  // 1. Fixed key files
  const files = ['agents.json', 'sessions.json', 'api_config.json', 'api_profiles.json', 'file_whitelist.json', 'face_print.json', 'architecture.json', 'history.json', 'token_usage.json'];
  for (const f of files) {
    const fp = dataFile(f);
    if (fs.existsSync(fp)) {
      try { all[f.replace('.json', '')] = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) {}
    }
  }
  // 2. Chat history files (*.json in chat_history/{agentId}/ dirs)
  if (fs.existsSync(CHAT_HISTORY_DIR)) {
    const agentDirs = fs.readdirSync(CHAT_HISTORY_DIR, { withFileTypes: true });
    for (const ent of agentDirs) {
      if (!ent.isDirectory()) continue;
      const agentId = ent.name;
      const agentDir = path.join(CHAT_HISTORY_DIR, agentId);
      const chatFiles = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));
      // Load the most recent file for this agent
      if (chatFiles.length > 0) {
        chatFiles.sort().reverse();
        try {
          const data = JSON.parse(fs.readFileSync(path.join(agentDir, chatFiles[0]), 'utf8'));
          all['chat_' + agentId] = data;
        } catch(e) {}
      }
    }
  }
  return all;
});

// — Generic key-value
ipcMain.handle('store:get', async (_, key) => {
  const fp = dataFile(key + '.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
});

ipcMain.handle('store:set', async (_, key, data) => {
  try { fs.writeFileSync(dataFile(key + '.json'), JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
});

ipcMain.handle('store:remove', async (_, key) => {
  try { const fp = dataFile(key + '.json'); if (fs.existsSync(fp)) fs.unlinkSync(fp); return true; }
  catch { return false; }
});

// — Chat messages (per-agent)
ipcMain.handle('store:getChat', async (_, agentId) => {
  const fp = chatFile(agentId);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
});

ipcMain.handle('store:setChat', async (_, agentId, data) => {
  try { fs.writeFileSync(chatFile(agentId), JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
});

ipcMain.handle('store:deleteChat', async (_, agentId) => {
  try { const fp = chatFile(agentId); if (fs.existsSync(fp)) fs.unlinkSync(fp); return true; }
  catch { return false; }
});

// — Chat history (per-agent, per-session files in chat_history/{agentId}/)
ipcMain.handle('store:getChatFiles', async (_, agentId) => {
  const dir = path.join(CHAT_HISTORY_DIR, agentId);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch { return []; }
});

ipcMain.handle('store:saveChatFile', async (_, agentId, filename, data) => {
  try {
    const dir = agentChatDir(agentId);
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
});

ipcMain.handle('store:getChatFile', async (_, agentId, filename) => {
  const fp = path.join(CHAT_HISTORY_DIR, agentId, filename);
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
});

ipcMain.handle('store:deleteChatDir', async (_, agentId) => {
  const dir = path.join(CHAT_HISTORY_DIR, agentId);
  if (!fs.existsSync(dir)) return true;
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch { return false; }
});

// — History
ipcMain.handle('store:getHistory', async () => {
  const fp = dataFile('history.json');
  if (!fs.existsSync(fp)) return { history: [], snapshots: [] };
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return { history: [], snapshots: [] }; }
});

ipcMain.handle('store:saveHistory', async (_, data) => {
  try { fs.writeFileSync(dataFile('history.json'), JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
});

// — Architecture memory
ipcMain.handle('store:getArchitecture', async () => {
  const fp = dataFile('architecture.json');
  if (!fs.existsSync(fp)) return null;
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
});

ipcMain.handle('store:saveArchitecture', async (_, data) => {
  try { fs.writeFileSync(dataFile('architecture.json'), JSON.stringify(data, null, 2)); return true; }
  catch { return false; }
});

// ══════════════════════════════════════════════════════════════
// IPC — FILE SYSTEM (replaces server.py endpoints)
// ══════════════════════════════════════════════════════════════

ipcMain.handle('fs:read', async (_, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return { error: 'File not found' };
    if (fs.statSync(filePath).isDirectory()) return { error: 'EISDIR: path is a directory, not a file' };
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, size: content.length };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('fs:write', async (_, filePath, content) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath, size: content.length };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('fs:list', async (_, dirPath, recursive) => {
  try {
    if (!dirPath) {
      const drives = [];
      for (let d = 65; d <= 90; d++) {
        const drive = String.fromCharCode(d) + ':\\';
        if (fs.existsSync(drive)) drives.push({ name: drive, type: 'drive' });
      }
      return drives;
    }
    if (recursive) {
      const entries = [];
      entries._count = 0;
      walkRecursive(dirPath, entries);
      delete entries._count;
      return entries;
    }
    const raw = fs.readdirSync(dirPath, { withFileTypes: true });
    const entries = [];
    for (const e of raw) {
      try {
        const fullPath = path.join(dirPath, e.name);
        const isDir = e.isDirectory();
        entries.push({
          name: e.name,
          path: fullPath,
          type: isDir ? 'dir' : 'file',
          size: isDir ? 0 : fs.statSync(fullPath).size,
        });
      } catch (statErr) {
        // skip entries we can't stat (permission denied, etc.)
      }
    }
    return entries;
  } catch (e) { return { error: e.message }; }
});

function walkRecursive(dirPath, entries) {
  if (entries._count >= 3000) return;
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of items) {
      if (entries._count >= 3000) return;
      const fullPath = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        entries.push({ name: e.name, path: fullPath, type: 'dir', folder: path.dirname(dirPath) });
        entries._count++;
        walkRecursive(fullPath, entries);
      } else {
        entries.push({ name: e.name, path: fullPath, type: 'file' });
        entries._count++;
      }
    }
  } catch (e) {}
}

ipcMain.handle('fs:search', async (_, query, roots) => {
  try {
    const q = (query || '').toLowerCase();
    if (!q || q.length < 1) return [];
    const rootList = (roots || '').split(';').filter(Boolean);
    const results = [];
    const seen = new Set();
    for (const root of rootList) {
      if (!fs.existsSync(root)) continue;
      walkDir(root, q, results, seen, 0);
    }
    return results.slice(0, 500);
  } catch (e) { return []; }
});

function walkDir(dirPath, query, results, seen, depth) {
  if (depth > 4 || results.length >= 500) return;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = path.join(dirPath, e.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      try {
        if (e.name.toLowerCase().includes(query)) {
          results.push({ name: e.name, path: fullPath, type: e.isDirectory() ? 'dir' : 'file' });
        }
        if (e.isDirectory()) walkDir(fullPath, query, results, seen, depth + 1);
      } catch (entryErr) {
        // skip entries we can't access
      }
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
// IPC — COMMAND EXECUTION (sandboxed, replaces server.py /api/run)
// ══════════════════════════════════════════════════════════════

const ALLOWED_BASES = {
  test:    ['pytest', 'python', 'npm', 'npx', 'node'],
  build:   ['python', 'npm', 'node', 'pip', 'npx'],
  venv:    ['python'],
  install: ['pip', 'npm'],
  lint:    ['python', 'npm', 'npx'],
};
const SHELL_CHARS = [';', '|', '&&', '||', '`', '$', '>', '<', '&', '(', ')', '{', '}'];

ipcMain.handle('fs:run', async (_, cmd, cwd, capability) => {
  // Validate
  if (!cmd) return { error: 'cmd is required' };
  for (const ch of SHELL_CHARS) {
    if (cmd.includes(ch)) return { error: `Sandbox: shell chaining character "${ch}" blocked` };
  }
  const cap = capability || 'test';
  const bases = ALLOWED_BASES[cap];
  if (!bases) return { error: `Unknown capability: ${cap}` };
  const cmdBase = cmd.split(' ')[0].toLowerCase();
  if (!bases.includes(cmdBase)) return { error: `Sandbox: "${cmdBase}" not in ${cap} allowed list` };

  try {
    const result = await new Promise((resolve, reject) => {
      exec(cmd, { cwd: cwd || process.cwd(), timeout: 60000 }, (err, stdout, stderr) => {
        resolve({ exitCode: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' });
      });
    });
    const summary = {};
    const text = result.stdout + result.stderr;
    const pm = text.match(/(\d+)\s+passed/); if (pm) summary.passed = parseInt(pm[1]);
    const fm = text.match(/(\d+)\s+failed/); if (fm) summary.failed = parseInt(fm[1]);
    const em = text.match(/(\d+)\s+errors?/); if (em) summary.errors = parseInt(em[1]);
    // First failure line
    const failLines = text.split('\n').filter(l => l.includes('FAIL') || l.includes('Error:'));
    if (failLines.length > 0) summary.first_failure = failLines[0].trim().slice(0, 200);

    return {
      success: result.exitCode === 0,
      exit_code: result.exitCode,
      stdout: result.stdout.slice(0, 10000),
      stderr: result.stderr.slice(0, 5000),
      summary,
    };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Window controls ──
ipcMain.handle('win:minimize', () => win?.minimize());
ipcMain.handle('win:close', () => app.quit());
ipcMain.handle('win:toggleFullscreen', () => {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false); else win.setFullScreen(true);
});

// ══════════════════════════════════════════════════════════════
// IPC — LANGGRAPH ENGINE (Python sidecar)
// ══════════════════════════════════════════════════════════════

const LG_PORT = 8765;
let lgProcess = null;
let lgReady = false;

function startLangGraphEngine() {
  const enginePath = path.join(__dirname, 'engine', 'server.py');
  if (!fs.existsSync(enginePath)) {
    console.warn('[LangGraph] engine/server.py not found, skipping');
    return;
  }
  lgProcess = require('child_process').spawn('python', [enginePath, String(LG_PORT)], {
    cwd: path.join(__dirname, 'engine'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  lgProcess.stdout.on('data', d => console.log(`[LangGraph] ${d.toString().trim()}`));
  lgProcess.stderr.on('data', d => console.log(`[LangGraph] ${d.toString().trim()}`));
  lgProcess.on('exit', (code) => {
    console.log(`[LangGraph] process exited (code ${code})`);
    lgProcess = null; lgReady = false;
  });
  // Wait for server to be ready
  let tries = 0;
  const check = setInterval(() => {
    tries++;
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${LG_PORT}/lg/health`, (res) => {
      if (res.statusCode === 200) { lgReady = true; clearInterval(check); console.log('[LangGraph] engine ready'); }
    });
    req.on('error', () => { if (tries > 30) { clearInterval(check); console.warn('[LangGraph] engine failed to start'); } });
    req.setTimeout(1000, () => { req.destroy(); });
  }, 500);
}

function stopLangGraphEngine() {
  if (lgProcess) { lgProcess.kill(); lgProcess = null; lgReady = false; }
}

function lgFetch(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    if (!lgReady) return reject(new Error('LangGraph engine not ready'));
    const url = `http://127.0.0.1:${LG_PORT}${endpoint}`;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
      method, headers: { 'Content-Type': 'application/json' }, timeout: 120000,
    };
    const http = require(method === 'GET' ? 'http' : 'http');
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('LangGraph request timed out')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

ipcMain.handle('lg:status', async () => ({ ready: lgReady, port: LG_PORT }));
ipcMain.handle('lg:run', async (_, data) => {
  try { return await lgFetch('POST', '/lg/run', data); }
  catch (e) { return { error: e.message, text: '' }; }
});
ipcMain.handle('lg:memoryStore', async (_, data) => {
  try { return await lgFetch('POST', '/lg/memory/store', data); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('lg:memoryQuery', async (_, q, k) => {
  try { return await lgFetch('GET', `/lg/memory/query?q=${encodeURIComponent(q)}&k=${k || 5}`); }
  catch (e) { return { results: [] }; }
});
ipcMain.handle('lg:sessionList', async () => {
  try { return await lgFetch('GET', '/lg/sessions'); }
  catch (e) { return { sessions: [] }; }
});
