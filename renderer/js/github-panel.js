/**
 * GITHUB PANEL — Split view: MY REPOS | STARRED
 */

let githubPanelOpen = false;

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('github-toggle');
  const panel = document.getElementById('github-panel');
  const closeBtn = document.getElementById('close-github-btn');

  if (!toggleBtn || !panel) return;

  toggleBtn.addEventListener('click', () => {
    githubPanelOpen = !githubPanelOpen;
    if (githubPanelOpen) {
      panel.classList.add('github-panel-open');
      panel.classList.remove('github-panel-collapsed');
      toggleBtn.classList.add('on');
      loadGitHubData();
    } else {
      panel.classList.remove('github-panel-open');
      panel.classList.add('github-panel-collapsed');
      toggleBtn.classList.remove('on');
    }
  });

  closeBtn.addEventListener('click', () => {
    githubPanelOpen = false;
    panel.classList.remove('github-panel-open');
    panel.classList.add('github-panel-collapsed');
    if (toggleBtn) toggleBtn.classList.remove('on');
  });

  // Starred refresh
  document.getElementById('gh-starred-refresh')?.addEventListener('click', () => {
    _dataLoaded = false;
    loadGitHubData();
  });

  // Search filters
  document.getElementById('gh-repo-search')?.addEventListener('input', renderRepoList);
  document.getElementById('gh-starred-search')?.addEventListener('input', renderStarredList);

  // Event delegation for repo items (prevents XSS from inline onclick)
  const reposEl = document.getElementById('gh-repo-list');
  const starredEl = document.getElementById('gh-starred-list');
  [reposEl, starredEl].forEach(el => {
    if (el) {
      el.addEventListener('click', (e) => {
        const cloneBtn = e.target.closest('[data-gclone-name]');
        if (cloneBtn) {
          e.stopPropagation();
          const fullName = cloneBtn.getAttribute('data-gclone-name');
          const cloneUrl = cloneBtn.getAttribute('data-gclone-url');
          ghCloneToWorkspace(decodeURIComponent(fullName), decodeURIComponent(cloneUrl));
          return;
        }
        const item = e.target.closest('.gh-repo-item');
        if (item) {
          const url = item.getAttribute('data-repo-clone');
          if (url) window.open(url, '_blank');
        }
      });
    }
  });
});

// ─── Load data ────────────────────────────────────────────────
let _allRepos = [];
let _allStarred = [];
let _dataLoaded = false;

async function loadGitHubData() {
  if (!window.GitHub || !window.GitHub.token()) {
    const empty = '<div class="gh-empty">Configure token in [API]</div>';
    const repoEl = document.getElementById('gh-repo-list');
    const starEl = document.getElementById('gh-starred-list');
    if (repoEl) repoEl.innerHTML = empty;
    if (starEl) starEl.innerHTML = empty;
    return;
  }

  if (_dataLoaded) {
    renderRepoList();
    renderStarredList();
    return;
  }

  const reposEl = document.getElementById('gh-repo-list');
  const starredEl = document.getElementById('gh-starred-list');
  if (reposEl) reposEl.innerHTML = '<div class="gh-loading">Loading...</div>';
  if (starredEl) starredEl.innerHTML = '<div class="gh-loading">Loading...</div>';

  try {
    const [repos, starred] = await Promise.all([
      window.GitHub.listAllMyRepos().catch(() => []),
      window.GitHub.listAllStarred().catch(() => []),
    ]);
    _allRepos = repos;
    _allStarred = starred;
    _dataLoaded = true;

    renderRepoList();
    renderStarredList();
  } catch (e) {
    if (reposEl) reposEl.innerHTML = `<div class="gh-empty">Error: ${escapeHtml(e.message)}</div>`;
    if (starredEl) starredEl.innerHTML = `<div class="gh-empty">Error: ${escapeHtml(e.message)}</div>`;
  }
}

// ─── Render functions ─────────────────────────────────────────
function renderRepoList() {
  const el = document.getElementById('gh-repo-list');
  if (!el) return;
  const q = (document.getElementById('gh-repo-search')?.value || '').toLowerCase();
  let repos = _allRepos;
  if (q) repos = repos.filter(r => (r.full_name || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  if (repos.length === 0) { el.innerHTML = q ? '<div class="gh-empty">No match</div>' : '<div class="gh-empty">No repos</div>'; return; }

  el.innerHTML = repos.map((r, i) => {
    const langTag = r.language ? `<span class="gh-repo-lang">${escapeHtml(r.language)}</span>` : '';
    const starsTag = r.stargazers_count > 0 ? `<span class="gh-repo-stars">★${r.stargazers_count}</span>` : '';
    const privateTag = r.private ? '<span class="gh-repo-private">🔒</span>' : '';
    const desc = r.description ? `<div class="gh-repo-desc">${escapeHtml(r.description)}</div>` : '';
    const safeName = escapeHtml(r.name);
    const safeFullName = escapeHtml(r.full_name);
    const safeCloneUrl = escapeHtml(r.clone_url);
    return `<div class="gh-repo-item" data-repo-name="${safeFullName}" data-repo-clone="${safeCloneUrl}" title="${escapeHtml(r.full_name)}">
      <span class="gh-repo-name">${safeName}${privateTag}</span>
      ${langTag}${starsTag}
      <div class="gh-repo-actions">
        <button class="gh-repo-btn" data-gclone-name="${safeFullName}" data-gclone-url="${safeCloneUrl}">CLONE</button>
      </div>
      ${desc}
    </div>`;
  }).join('');
}

function renderStarredList() {
  const el = document.getElementById('gh-starred-list');
  if (!el) return;
  const q = (document.getElementById('gh-starred-search')?.value || '').toLowerCase();
  let repos = _allStarred;
  if (q) repos = repos.filter(r => (r.full_name || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q));
  if (repos.length === 0) { el.innerHTML = q ? '<div class="gh-empty">No match</div>' : '<div class="gh-empty">No starred</div>'; return; }

  el.innerHTML = repos.map((r, i) => {
    const langTag = r.language ? `<span class="gh-repo-lang">${escapeHtml(r.language)}</span>` : '';
    const starsTag = r.stargazers_count > 0 ? `<span class="gh-repo-stars">★${r.stargazers_count}</span>` : '';
    const desc = r.description ? `<div class="gh-repo-desc">${escapeHtml(r.description)}</div>` : '';
    const safeFullName = escapeHtml(r.full_name);
    const safeCloneUrl = escapeHtml(r.clone_url);
    return `<div class="gh-repo-item" data-repo-name="${safeFullName}" data-repo-clone="${safeCloneUrl}" title="${escapeHtml(r.full_name)}">
      <span class="gh-repo-name">${escapeHtml(r.name)}</span>
      ${langTag}${starsTag}
      <div class="gh-repo-actions">
        <button class="gh-repo-btn" data-gclone-name="${safeFullName}" data-gclone-url="${safeCloneUrl}">CLONE</button>
      </div>
      ${desc}
    </div>`;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────────
async function ghCloneToWorkspace(fullName, cloneUrl) {
  showToast(`// CLONING ${fullName} //`);
  if (typeof ipcRunCommand === 'function') {
    try {
      await ipcRunCommand(`git clone ${cloneUrl}`, '');
      showToast(`// CLONE OK: ${fullName} //`);
    } catch (e) {
      showToast(`// CLONE FAILED: ${e.message} //`);
    }
  } else {
    navigator.clipboard?.writeText(`git clone ${cloneUrl}`);
    showToast(`// Clone command copied: git clone ${cloneUrl} //`);
  }
}
