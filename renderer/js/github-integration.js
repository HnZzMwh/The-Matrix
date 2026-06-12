/**
 * GITHUB INTEGRATION
 *
 * Token stored in cfg.githubToken (persisted via localStorage + Electron store).
 * Core functions: verify token, list repos, list starred, read files, write files.
 */

const GH_API = 'https://api.github.com';

// ─── Token management ─────────────────────────────────────────
function ghToken() {
  return (typeof cfg !== 'undefined' && cfg.githubToken) || '';
}

function ghHeaders() {
  const t = ghToken();
  if (!t) return {};
  return {
    'Authorization': `Bearer ${t}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghFetch(url, opts = {}) {
  const headers = { ...ghHeaders(), ...(opts.headers || {}) };
  const resp = await fetchWithTimeout(url, { ...opts, headers }, 30000);
  const data = await resp.json();
  if (!resp.ok) {
    const msg = data.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

// ─── Verify token ─────────────────────────────────────────────
async function verifyGithubToken() {
  if (!ghToken()) return { ok: false, user: null, error: 'No token' };
  try {
    const user = await ghFetch(`${GH_API}/user`);
    return { ok: true, user: user.login, name: user.name, avatar: user.avatar_url, plan: user.plan?.name };
  } catch (e) {
    return { ok: false, user: null, error: e.message };
  }
}

// ─── List my repos ────────────────────────────────────────────
async function listMyRepos(page = 1, perPage = 30) {
  if (!ghToken()) return [];
  return await ghFetch(`${GH_API}/user/repos?per_page=${perPage}&page=${page}&sort=updated&type=all`);
}

async function listAllMyRepos() {
  if (!ghToken()) return [];
  const all = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(`${GH_API}/user/repos?per_page=100&page=${page}&sort=updated&type=all`);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

// ─── List starred repos ───────────────────────────────────────
async function listStarredRepos(page = 1, perPage = 30) {
  if (!ghToken()) return [];
  return await ghFetch(`${GH_API}/user/starred?per_page=${perPage}&page=${page}&sort=created&direction=desc`);
}

async function listAllStarred() {
  if (!ghToken()) return [];
  const all = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(`${GH_API}/user/starred?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

// ─── Get repo contents (file tree) ────────────────────────────
async function getRepoContents(owner, repo, path = '') {
  if (!ghToken()) throw new Error('Token required');
  const url = path
    ? `${GH_API}/repos/${owner}/${repo}/contents/${path}`
    : `${GH_API}/repos/${owner}/${repo}/contents`;
  return await ghFetch(url);
}

// ─── Read a file from a repo ──────────────────────────────────
async function readRepoFile(owner, repo, path, ref = '') {
  if (!ghToken()) throw new Error('Token required');
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${path}` + (ref ? `?ref=${ref}` : '');
  const data = await ghFetch(url);
  if (data.encoding === 'base64' && data.content) {
    try {
      // GitHub API returns base64 with newlines
      const clean = data.content.replace(/\n/g, '');
      return atob(clean);
    } catch { return data.content; }
  }
  return null;
}

// ─── Write/update a file in a repo ────────────────────────────
async function writeRepoFile(owner, repo, path, content, message, branch = 'main') {
  if (!ghToken()) throw new Error('Token required');
  let sha = null;
  try {
    const existing = await ghFetch(`${GH_API}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    sha = existing.sha;
  } catch {} // file doesn't exist yet — that's fine

  const body = { message, content: btoa(unescape(encodeURIComponent(content))), branch };
  if (sha) body.sha = sha;

  const resp = await fetchWithTimeout(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 30000);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
  return data;
}

// ─── Create a branch ──────────────────────────────────────────
async function createBranch(owner, repo, branchName, baseBranch = 'main') {
  if (!ghToken()) throw new Error('Token required');
  const base = await ghFetch(`${GH_API}/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`);
  const sha = base.object.sha;
  const resp = await fetchWithTimeout(`${GH_API}/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha }),
  }, 30000);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
  return data;
}

// ─── Create a PR ──────────────────────────────────────────────
async function createPR(owner, repo, title, head, base = 'main', body = '') {
  if (!ghToken()) throw new Error('Token required');
  const resp = await fetchWithTimeout(`${GH_API}/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head, base, body, maintainer_can_modify: true }),
  }, 30000);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
  return data;
}

// ─── Check if a repo has skill.json(s) ───────────────────────
// Returns: null (none) | single skill object | array of skill objects
async function checkRepoSkill(owner, repo) {
  if (!ghToken()) return null;

  const fullName = owner + '/' + repo;

  // Strategy 1: skill.json at repo root
  const rootMeta = await ghTrySkillJson(owner, repo, 'skill.json');
  if (rootMeta) {
    console.log('[GitHub] ✓ Found root skill.json in', fullName);
    return rootMeta; // single skill
  }
  console.log('[GitHub] · No root skill.json in', fullName);

  // Strategy 2: skills/ directory (monorepo pattern: anthropics/skills, mattpocock/skills)
  const skillsDir = await ghTryListDir(owner, repo, 'skills');
  console.log('[GitHub] · skills/ dir for', fullName, ':', skillsDir ? `ok (${Array.isArray(skillsDir) ? skillsDir.length : 'not array'} items)` : 'EMPTY/404');
  if (skillsDir && Array.isArray(skillsDir)) {
    const subs = skillsDir.filter(item => item.type === 'dir');
    console.log('[GitHub]   subdirs in skills/:', subs.length, '→', subs.map(s => s.name).join(', '));
    const skills = [];
    for (const item of subs) {
      const meta = await ghTrySkillJson(owner, repo, `skills/${item.name}/skill.json`);
      if (meta) {
        skills.push({ ...meta, skillDir: item.name });
        console.log('[GitHub] ✓ Found skill at skills/' + item.name + ' in', fullName);
      } else {
        console.log('[GitHub] · skills/' + item.name + '/skill.json not found in', fullName);
      }
    }
    if (skills.length > 0) return skills;
  }

  // Strategy 3: check each top-level directory for skill.json
  const rootDir = await ghTryListDir(owner, repo, '');
  console.log('[GitHub] · root dir for', fullName, ':', rootDir ? `ok (${Array.isArray(rootDir) ? rootDir.length : 'not array'} items)` : 'EMPTY/404');
  if (rootDir && Array.isArray(rootDir)) {
    const dirs = rootDir.filter(item => item.type === 'dir' && item.name !== '.git' && item.name !== 'node_modules' && !item.name.startsWith('.'));
    const skills = [];
    for (const item of dirs) {
      const meta = await ghTrySkillJson(owner, repo, `${item.name}/skill.json`);
      if (meta) {
        skills.push({ ...meta, skillDir: item.name });
        console.log('[GitHub] ✓ Found skill at', item.name, 'in', fullName);
      }
    }
    if (skills.length > 0) return skills;
  }

  console.log('[GitHub] ✗ No skill.json found in', fullName);
  return null;
}

async function ghTrySkillJson(owner, repo, filePath) {
  if (!ghToken()) return null;
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${filePath}`;
  try {
    const data = await ghFetch(url);
    if (!data || !data.content) {
      console.log('[GitHub]   skill.json response has no .content at', filePath);
      return null;
    }
    const clean = data.content.replace(/\n/g, '');
    const decoded = atob(clean);
    return JSON.parse(decoded);
  } catch (e) {
    console.log('[GitHub]   ghTrySkillJson failed at', owner + '/' + repo + '/' + filePath, '|', e.message || e);
    return null;
  }
}

async function ghTryListDir(owner, repo, dirPath) {
  if (!ghToken()) return null;
  const url = dirPath
    ? `${GH_API}/repos/${owner}/${repo}/contents/${dirPath}`
    : `${GH_API}/repos/${owner}/${repo}/contents`;
  try {
    return await ghFetch(url);
  } catch (e) {
    console.log('[GitHub]   ghTryListDir failed for', owner + '/' + repo + '/' + (dirPath || '(root)'), '|', e.message || e);
    return null; // 404 or empty — that's fine
  }
}

// ─── Search starred repos for skills ──────────────────────────
async function searchStarredSkills() {
  if (!ghToken()) {
    console.log('[GitHub] searchStarredSkills: no token');
    return [];
  }
  try {
    const starred = await listAllStarred();
    console.log('[GitHub] searchStarredSkills: scanning', starred.length, 'starred repos');
    const results = [];
    for (let i = 0; i < starred.length; i++) {
      const repo = starred[i];
      // Show progress in UI
      if (typeof window._ghScanProgress === 'function') {
        window._ghScanProgress(i + 1, starred.length, repo.full_name);
      }
      try {
        const result = await checkRepoSkill(repo.owner.login, repo.name);
        if (!result) continue;
        const items = Array.isArray(result) ? result : [result];
        for (const skillMeta of items) {
          const skillId = skillMeta.name || skillMeta.skillDir || repo.name;
          results.push({
            owner: repo.owner.login,
            repo: repo.name,
            description: repo.description || '',
            stars: repo.stargazers_count,
            language: repo.language,
            skill: skillMeta,
            skillDir: skillMeta.skillDir || null,
            html_url: repo.html_url,
            clone_url: repo.clone_url,
          });
        }
      } catch {} // skip repos without skill.json
    }
    console.log('[GitHub] searchStarredSkills: found', results.length, 'skills');
    return results;
  } catch (e) {
    console.warn('[GitHub] searchStarredSkills failed:', e.message);
    return [];
  }
}

// ─── Agent tool: search for code in a repo ────────────────────
async function searchRepoCode(owner, repo, query) {
  if (!ghToken()) throw new Error('Token required');
  const data = await ghFetch(`${GH_API}/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repo}`);
  return (data.items || []).map(i => ({
    path: i.path,
    name: i.name,
    url: i.html_url,
    repo: i.repository?.full_name,
  }));
}

// ─── Clone URL helpers ────────────────────────────────────────
function getCloneUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

function getSwizzleUrl(owner, repo) {
  return `github:${owner}/${repo}`;
}

// ─── Expose ───────────────────────────────────────────────────
window.GitHub = {
  token: ghToken,
  verify: verifyGithubToken,
  listMyRepos,
  listAllMyRepos,
  listStarredRepos,
  listAllStarred,
  getRepoContents,
  readRepoFile,
  writeRepoFile,
  createBranch,
  createPR,
  checkRepoSkill,
  searchStarredSkills,
  searchRepoCode,
  getCloneUrl,
  getSwizzleUrl,
};
