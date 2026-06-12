// ============================================================
// FILE BROWSER — Whitelist manager + fast filename search
// ============================================================

const WHITELIST_KEY = 'matrix_file_whitelist';
let fileBrowserOpen = false;
let currentBrowsePath = 'C:\\';
let searchDebounceTimer = null;

// Helper: escape a path string for use as a data-* attribute value
const attrPath = p => escapeHtml(p).replace(/"/g, '&quot;');

// ─── Whitelist ─────────────────────────────────────────────
function getWhitelist() {
  try {
    return JSON.parse(localStorage.getItem(WHITELIST_KEY) || '[]');
  } catch(e) { return []; }
}

function saveWhitelist(list) {
  localStorage.setItem(WHITELIST_KEY, JSON.stringify(list));
  renderWhitelist();
}

function resolvePath(p) {
  if (!p || typeof p !== 'string') return p;
  const normalized = p.replace(/\//g, '\\');
  // Already absolute (drive letter or UNC)
  if (/^[a-zA-Z]:\\/.test(normalized) || /^\\\\/.test(normalized)) return normalized;
  // Relative — resolve .. / . / against app root
  const root = ((window.electronAPI && window.electronAPI.appRoot) || '').replace(/\\+$/, '');
  if (!root) return normalized;
  const parts = normalized.split('\\');
  const base = root.split('\\');
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (base.length > 1) base.pop(); }
    else base.push(seg);
  }
  const resolved = base.join('\\');
  if (resolved.toLowerCase() !== root.toLowerCase() && !resolved.toLowerCase().startsWith(root.toLowerCase() + '\\')) {
    return p;
  }
  return resolved;
}

function isPathWhitelisted(path) {
  if (!path || typeof path !== 'string') return false;
  const list = getWhitelist();
  const normalized = resolvePath(path);
  return list.some(wp => normalized.toLowerCase().startsWith(wp.replace(/\//g, '\\').replace(/\\\\/g, '\\').toLowerCase()));
}

function addToWhitelist(path) {
  const list = getWhitelist();
  if (!list.includes(path)) {
    list.push(path);
    saveWhitelist(list);
  }
}

function removeFromWhitelist(path) {
  const list = getWhitelist().filter(p => p !== path);
  saveWhitelist(list);
}

// ─── Render whitelist UI ──────────────────────────────────
function renderWhitelist() {
  const el = document.getElementById('fb-whitelist');
  if (!el) return;
  const list = getWhitelist();

  if (list.length === 0) {
    el.innerHTML = '<div class="fb-empty">No paths whitelisted.<br>Browse and add files below.</div>';
    return;
  }

  el.innerHTML = list.map(p =>
    `<div class="fb-wl-item">
      <span class="fb-wl-path" title="${attrPath(p)}">${escapeHtml(p)}</span>
      <button class="fb-wl-remove" data-path="${attrPath(p)}" data-action="remove">[X]</button>
    </div>`
  ).join('');
}

// ─── Browse directory ─────────────────────────────────────
async function browseDirectory(path, recursive) {
  currentBrowsePath = path;
  const el = document.getElementById('fb-dir-contents');
  if (!el) return;
  el.innerHTML = '<div class="fb-loading">Loading...</div>';

  try {
    const ea = (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;
    if (!ea) { el.innerHTML = '<div class="fb-empty">Electron API not available.</div>'; return; }
    const data = await ea.fs.list(path, !!recursive);
    if (!Array.isArray(data)) { el.innerHTML = '<div class="fb-empty">Cannot access: ' + ((data||{}).error || path) + '</div>'; return; }

    // Parent directory link (flat mode only, not at drive root)
    let html = '';
    const driveMatch = path.replace(/\\$/, '').match(/^[A-Za-z]:$/);

    if (!driveMatch) {
      const parent = path.replace(/\\$/, '').split('\\').slice(0, -1).join('\\') || 'C:\\';
      html += `<div class="fb-entry"><span class="fb-entry-icon">▸</span><span class="fb-entry-name fb-nav" data-path="${attrPath(parent)}">..</span></div>`;
    }

    // Browse: always show [ADD], never [REMOVE] — remove is only in whitelist
    if (recursive) {
      for (const e of data) {
        const displayPath = e.path || e.name;
        if (e.type === 'dir') {
          html += `<div class="fb-entry fb-folder-hdr">
            <span class="fb-entry-icon">▸</span>
            <span class="fb-entry-name fb-nav" data-path="${attrPath(displayPath)}">${escapeHtml(e.name)}</span>
            <button class="fb-wl-btn" data-path="${attrPath(displayPath)}" data-action="add">[ADD]</button>
          </div>`;
        } else {
          html += `<div class="fb-entry">
            <span class="fb-entry-icon" style="opacity:0.6">◈</span>
            <span class="fb-entry-name" title="${attrPath(displayPath)}">${escapeHtml(e.name)}</span>
            <button class="fb-wl-btn" data-path="${attrPath(displayPath)}" data-action="add">[ADD]</button>
          </div>`;
        }
      }
    } else {
      for (const e of data) {
        const isDir = e.type === 'dir' || e.type === 'drive';
        const displayPath = e.path || e.name;
        const icon = e.type === 'drive' ? '▣' : isDir ? '▸' : '◈';
        html += `<div class="fb-entry">
          <span class="fb-entry-icon">${icon}</span>
          <span class="fb-entry-name fb-nav" data-path="${attrPath(displayPath)}">
            ${escapeHtml(isDir ? e.name + '\\' : e.name)}
          </span>
          <button class="fb-wl-btn" data-path="${attrPath(displayPath)}" data-action="add">[ADD]</button>
        </div>`;
      }

      html += `<div class="fb-entry" style="border-top:1px solid #061a08;margin-top:4px;padding-top:4px">
        <span class="fb-entry-name fb-nav" data-path="${attrPath(path)}" data-recursive="true" style="color:#006622;font-size:8px">
          >> SHOW ALL FILES IN SUBFOLDERS
        </span>
      </div>`;
    }

    if (!html) html = '<div class="fb-empty">(empty directory)</div>';
    el.innerHTML = html;
    document.getElementById('fb-path-input').value = path;

  } catch (e) {
    el.innerHTML = '<div class="fb-empty">Error loading directory.</div>';
  }

  // Re-run search with new browse path if user had typed a query
  const searchInput = document.getElementById('fb-search-input');
  if (searchInput && searchInput.value.trim()) {
    searchFilenames(searchInput.value.trim());
  }
}

// ─── Search filenames (scoped to current browse path) ────
async function searchFilenames(query) {
  const resultsEl = document.getElementById('fb-search-results');
  if (!resultsEl) return;

  if (!query) {
    resultsEl.innerHTML = '<div class="fb-empty">Type a keyword to search files in current directory.</div>';
    return;
  }

  if (!currentBrowsePath) {
    resultsEl.innerHTML = '<div class="fb-empty">Browse to a directory first, then search.</div>';
    return;
  }

  resultsEl.innerHTML = '<div class="fb-loading">Searching <span class="fb-search-scope">' + escapeHtml(currentBrowsePath) + '</span>...</div>';

  try {
    const ea = (typeof window !== 'undefined' && window.electronAPI) ? window.electronAPI : null;
    if (!ea) { resultsEl.innerHTML = '<div class="fb-empty">Electron API not available.</div>'; return; }
    const data = await ea.fs.search(query, currentBrowsePath);

    if (!Array.isArray(data) || data.length === 0) {
      resultsEl.innerHTML = '<div class="fb-empty">No files matching "' + escapeHtml(query) + '".</div>';
      return;
    }

    // Search results: always show [ADD], uses delegated click handler via data attributes
    resultsEl.innerHTML = data.map(e => {
      const displayPath = e.path;
      return `<div class="fb-entry">
        <span class="fb-entry-icon">${e.type === 'dir' ? '▸' : '◈'}</span>
        <span class="fb-entry-name" title="${attrPath(displayPath)}">
          ${escapeHtml(e.name)}
          <span class="fb-entry-path">${escapeHtml(displayPath)}</span>
        </span>
        <button class="fb-wl-btn" data-path="${attrPath(displayPath)}" data-action="add">[ADD]</button>
      </div>`;
    }).join('');

  } catch (e) {
    resultsEl.innerHTML = '<div class="fb-empty">Search failed.</div>';
  }
}

// ─── Open / Close panel ──────────────────────────────────
function triggerFileBrowserRefresh() {
  if (typeof browseDirectory === 'function' && currentBrowsePath) {
    browseDirectory(currentBrowsePath);
  }
}

function openFileBrowser() {
  document.getElementById('file-browser-panel').classList.add('active');
  renderWhitelist();
  browseDirectory(currentBrowsePath);
  fileBrowserOpen = true;
}

function closeFileBrowser() {
  document.getElementById('file-browser-panel').classList.remove('active');
  fileBrowserOpen = false;
}

// ─── UI Events ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // FILES button
  const filesBtn = document.getElementById('files-btn');
  if (filesBtn) filesBtn.addEventListener('click', openFileBrowser);

  // GO button for path navigation
  const goBtn = document.getElementById('fb-go-btn');
  if (goBtn) goBtn.addEventListener('click', () => {
    const input = document.getElementById('fb-path-input');
    if (input && input.value.trim()) browseDirectory(input.value.trim());
  });

  // Path input: Enter key
  const pathInput = document.getElementById('fb-path-input');
  if (pathInput) pathInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      browseDirectory(pathInput.value.trim());
    }
  });

  // Search input: debounced real-time search
  const searchInput = document.getElementById('fb-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      const val = searchInput.value.trim();
      searchDebounceTimer = setTimeout(() => searchFilenames(val), 250);
    });
  }

  // ── Delegated click handler for file-browser panel ──
  // Reads data-path and data-action from fb-entry buttons/names
  const panel = document.getElementById('file-browser-panel');
  if (panel) {
    panel.addEventListener('click', e => {
      const target = e.target.closest('[data-path]');
      if (!target) return;

      const path = target.dataset.path;
      const action = target.dataset.action;
      const recursive = target.dataset.recursive === 'true';

      if (action === 'add') {
        addToWhitelist(path);
        // Re-render the current view
        browseDirectory(currentBrowsePath, false);
      } else if (action === 'remove') {
        removeFromWhitelist(path);
        browseDirectory(currentBrowsePath, false);
      } else if (recursive) {
        browseDirectory(path, true);
      } else {
        // Navigate into folder
        browseDirectory(path);
      }
    });
  }
});
