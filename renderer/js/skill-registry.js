/**
 * SKILL REGISTRY — Unified skill/tool/MCP lifecycle manager
 *
 * Three sources:
 *   1. GitHub Skill — fetch ZIP → extract → skill.json → loadPlugin
 *   2. GitHub MCP  — fetch repo → spawn subprocess → JSON-RPC tools
 *   3. Markdown     — drag/drop .md → importFromMarkdown
 *
 * Skill package structure (GitHub repo):
 *   my-skill/
 *   ├── skill.json       # required metadata
 *   ├── skill.md          # AI-readable skill prompt
 *   ├── tools/*.js        # JS tool functions
 *   └── mcp/server.py     # MCP server (stdio/json-rpc)
 */

const SKILL_DIR_NAME = 'skills';
const SKILL_REGISTRY_FILE = 'registry.json';
const SKILL_PERMISSIONS_FILE = 'mcp_configs.json';

class SkillRegistry {
  constructor(pluginManager) {
    this.pm = pluginManager;
    this.installed = new Map();       // skillId → { meta, tools, mcpProcess, path }
    this.sources = [];
    this._loaded = false;
  }

  // ==============================================================
  // LIFECYCLE
  // ==============================================================

  async init() {
    if (this._loaded) return;
    await this._loadRegistry();
    this._loaded = true;
    console.log('[SkillRegistry] Initialized with', this.installed.size, 'skills');
  }

  async _loadRegistry() {
    const reg = await this._readStore(SKILL_REGISTRY_FILE);
    if (!reg || !Array.isArray(reg.skills)) return;

    for (const entry of reg.skills) {
      try {
        await this._reloadSkill(entry);
      } catch (e) {
        console.warn('[SkillRegistry] Failed to reload skill', entry.id, e);
      }
    }
  }

  async _saveRegistry() {
    const skills = [];
    for (const [id, info] of this.installed) {
      skills.push({ id, source: info.source, version: info.version, installedAt: info.installedAt, path: info.path });
    }
    await this._writeStore(SKILL_REGISTRY_FILE, { skills, updated: Date.now() });
  }

  async _readStore(key) {
    const ea = window.electronAPI;
    if (ea && ea.store && ea.store.get) {
      return await ea.store.get(key);
    }
    try { return JSON.parse(localStorage.getItem('skill_' + key) || 'null'); } catch { return null; }
  }

  async _writeStore(key, data) {
    const ea = window.electronAPI;
    if (ea && ea.store && ea.store.set) {
      await ea.store.set(key, data);
    }
    try { localStorage.setItem('skill_' + key, JSON.stringify(data)); } catch {}
  }

  // ==============================================================
  // INSTALL / UNINSTALL
  // ==============================================================

  /**
   * Install a skill from extracted files (skill.json + tools + skill.md).
   */
  async install(skillId, meta, toolFiles, skillPrompt) {
    if (this.installed.has(skillId)) {
      throw new Error(`Skill "${skillId}" is already installed.`);
    }

    // Validate permissions
    if (meta.requires && Array.isArray(meta.requires)) {
      for (const perm of meta.requires) {
        if (!AVAILABLE_PERMISSIONS.has(perm)) {
          throw new Error(`Skill "${skillId}" requires unknown permission: ${perm}`);
        }
      }
    }

    // Create sandboxed tools from JS files
    const tools = {};
    for (const [filename, source] of Object.entries(toolFiles)) {
      try {
        const toolName = filename.replace(/\.js$/, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        tools[toolName] = this._compileTool(toolName, source, meta.requires || []);
      } catch (e) {
        console.error('[SkillRegistry] Tool compile error in', filename, e);
      }
    }

    // Register with PluginManager
    const pluginId = 'skill_' + skillId;
    this.pm.loadPlugin(pluginId, { tools }, meta.requires || []);

    // Store skill prompt for agent injection
    if (skillPrompt && typeof window._skillPrompts === 'undefined') {
      window._skillPrompts = {};
    }
    if (skillPrompt) {
      window._skillPrompts[skillId] = skillPrompt;
    }

    this.installed.set(skillId, {
      source: meta.source || 'manual',
      version: meta.version || '0.0.0',
      installedAt: Date.now(),
      meta,
      tools,
      path: meta.path || null,
    });

    await this._saveRegistry();
    console.log('[SkillRegistry] Installed:', skillId, 'with', Object.keys(tools).length, 'tools');
    return true;
  }

  /**
   * Uninstall a skill.
   */
  async uninstall(skillId) {
    const info = this.installed.get(skillId);
    if (!info) return false;

    // Stop MCP if running
    if (info.mcpProcess) {
      await this.stopMCPServer(skillId);
    }

    // Unregister from PluginManager
    this.pm.plugins.delete('skill_' + skillId);
    if (info.tools) {
      for (const name of Object.keys(info.tools)) {
        this.pm.tools.delete(name);
      }
    }

    // Remove skill prompt
    if (window._skillPrompts && window._skillPrompts[skillId]) {
      delete window._skillPrompts[skillId];
    }

    this.installed.delete(skillId);
    await this._saveRegistry();
    console.log('[SkillRegistry] Uninstalled:', skillId);
    return true;
  }

  // ==============================================================
  // GITHUB INSTALL
  // ==============================================================

  /**
   * Fetch skill metadata from a GitHub repo.
   * @param {string} ownerRepo - e.g. "user/repo"
   * @param {string} ref       - branch/tag, default "main"
   * @param {string} subPath   - optional subdirectory (e.g. "skills/doc-coauthoring" for monorepo)
   * Returns { skillId, meta, skillPrompt, toolFiles }
   */
  async fetchFromGitHub(ownerRepo, ref = 'main', subPath) {
    const apiBase = `https://api.github.com/repos/${ownerRepo}`;
    const prefix = subPath ? `${subPath}/` : '';

    // Step 1: Fetch skill.json
    let meta;
    try {
      const metaUrl = `${apiBase}/contents/${prefix}skill.json?ref=${ref}`;
      const metaResp = await fetch(metaUrl);
      if (!metaResp.ok) throw new Error('repo has no skill.json at ' + (prefix || 'root'));
      const metaData = await metaResp.json();
      meta = JSON.parse(atob(metaData.content));
    } catch (e) {
      throw new Error(`Failed to read skill.json from ${ownerRepo}${prefix ? '/' + subPath : ''}: ${e.message}`);
    }

    const skillId = meta.name || (subPath ? subPath.replace('skills/', '') : ownerRepo.replace('/', '-'));

    // Step 2: Fetch skill.md (skill prompt)
    let skillPrompt = '';
    try {
      const mdResp = await fetch(`${apiBase}/contents/${prefix}skill.md?ref=${ref}`);
      if (mdResp.ok) {
        const mdData = await mdResp.json();
        skillPrompt = atob(mdData.content);
      }
    } catch { /* optional */ }

    // Step 3: Fetch tool files
    const toolFiles = {};

    // Try prefix + entry
    if (meta.entry) {
      try {
        const entryUrl = `${apiBase}/contents/${prefix}${meta.entry}?ref=${ref}`;
        const entryResp = await fetch(entryUrl);
        if (entryResp.ok) {
          const entryData = await entryResp.json();
          toolFiles[(prefix + meta.entry).split('/').pop()] = atob(entryData.content);
        }
      } catch {}
    }

    // Try files in prefix + tools/ directory
    if (subPath) {
      try {
        const toolsUrl = `${apiBase}/contents/${prefix}tools?ref=${ref}`;
        const toolsResp = await fetch(toolsUrl);
        if (toolsResp.ok) {
          const toolsData = await toolsResp.json();
          for (const file of toolsData) {
            if (!file.name.endsWith('.js')) continue;
            try {
              const fileResp = await fetch(file.url || `${apiBase}/contents/${prefix}tools/${file.name}?ref=${ref}`);
              if (fileResp.ok) {
                const fileData = await fileResp.json();
                toolFiles[file.name] = atob(fileData.content);
              }
            } catch {}
          }
        }
      } catch {}
    } else {
      // Original: recursive tree scan for tools/ (only for root-level skills)
      try {
        const treeResp = await fetch(`${apiBase}/git/trees/${ref}?recursive=1`);
        if (treeResp.ok) {
          const tree = await treeResp.json();
          const toolPaths = (tree.tree || [])
            .filter(e => e.path.startsWith('tools/') && e.path.endsWith('.js'));

          for (const entry of toolPaths) {
            if (toolFiles[entry.path.split('/').pop()]) continue;
            try {
              const fileResp = await fetch(`${apiBase}/contents/${entry.path}?ref=${ref}`);
              if (fileResp.ok) {
                const fileData = await fileResp.json();
                toolFiles[entry.path.split('/').pop()] = atob(fileData.content);
              }
            } catch {}
          }
        }
      } catch {}
    }

    // If no tool files were fetched at all, create a minimal entry
    if (Object.keys(toolFiles).length === 0) {
      toolFiles['index.js'] = '// Auto-generated stub for ' + skillId;
    }

    // Step 4: Fetch repo info for metadata
    try {
      const repoResp = await fetch(apiBase);
      if (repoResp.ok) {
        const repoData = await repoResp.json();
        meta.stars = repoData.stargazers_count;
        meta.description = meta.description || repoData.description;
        meta.language = repoData.language;
        meta.license = repoData.license?.spdx_id;
        meta.updatedAt = repoData.updated_at;
      }
    } catch {}

    meta.source = `github:${ownerRepo}` + (subPath ? '/' + subPath : '');

    return { skillId, meta, skillPrompt, toolFiles };
  }

  /**
   * Install directly from a GitHub repo.
   * @param {string} ownerRepo - e.g. "user/repo"
   * @param {string} ref       - branch/tag
   * @param {string} subPath   - optional subdirectory for monorepo
   */
  async installFromGitHub(ownerRepo, ref = 'main', subPath) {
    const { skillId, meta, skillPrompt, toolFiles } = await this.fetchFromGitHub(ownerRepo, ref, subPath);
    return await this.install(skillId, meta, toolFiles, skillPrompt);
  }

  /**
   * Check for updates against installed skills from GitHub.
   */
  async checkUpdates() {
    const updates = [];
    for (const [skillId, info] of this.installed) {
      if (!info.meta || !info.meta.source || !info.meta.source.startsWith('github:')) continue;
      const ownerRepo = info.meta.source.replace('github:', '');
      try {
        const resp = await fetch(`https://api.github.com/repos/${ownerRepo}/releases/latest`);
        if (!resp.ok) continue;
        const release = await resp.json();
        const latest = (release.tag_name || 'v0').replace(/^v/, '');
        const current = String(info.version).replace(/^v/, '');
        if (latest !== current) {
          updates.push({ skillId, ownerRepo, current, latest, url: release.html_url });
        }
      } catch {}
    }
    return updates;
  }

  // ==============================================================
  // TOOL COMPILATION (Sandbox)
  // ==============================================================

  _compileTool(name, source, requires) {
    const ea = window.electronAPI;

    // Build sandbox API based on permissions
    const sandbox = {
      // Always available (no this/global/window/proxy)
      console: { log: (...a) => console.log(`[${name}]`, ...a), error: (...a) => console.error(`[${name}]`, ...a) },
      setTimeout: setTimeout.bind(window),
      JSON, Math, Date, String, Number, Array, Object, RegExp,
      parseInt, parseFloat, isNaN, isFinite, Error,
      Promise, Map, Set, WeakMap, WeakSet,
      decodeURI, encodeURI, encodeURIComponent, decodeURIComponent,
      btoa, atob,
      Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
      Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray,
      Promise, Map, Set,
      decodeURI, encodeURI, encodeURIComponent, decodeURIComponent,
      btoa, atob,

      // Permission-gated APIs
      fsRead: requires.includes('fs_read') ? (p) => ea?.fs?.readSafe(p) || Promise.resolve({ error: 'no EA' })
        : () => { throw new Error(`[SANDBOX] Tool "${name}" has no fs_read permission`); },

      fsWrite: requires.includes('fs_write') ? (p, c) => ea?.fs?.writeSafe(p, c) || Promise.resolve({ error: 'no EA' })
        : () => { throw new Error(`[SANDBOX] Tool "${name}" has no fs_write permission`); },

      fsList: requires.includes('fs_read') ? (p, r) => ea?.fs?.list(p, r) || Promise.resolve([])
        : () => { throw new Error(`[SANDBOX] Tool "${name}" has no fs_read permission`); },

      runCommand: requires.includes('run_command') ? (c, w, cap) => ea?.fs?.run(c, w, cap) || Promise.resolve({ error: 'no EA' })
        : () => { throw new Error(`[SANDBOX] Tool "${name}" has no run_command permission`); },

      fetch: requires.includes('network') ? (...a) => fetch(...a)
        : () => { throw new Error(`[SANDBOX] Tool "${name}" has no network permission`); },
    };

    // Compile with timeout wrapper (30s). Values are passed as Function parameters
    // to avoid leaking global scope (no `this`, `window`, `global`, `Proxy`, `Reflect`, etc.)
    const compiled = new Function('args', 'sandbox', `
      const { fsRead, fsWrite, fsList, runCommand, fetch, console, setTimeout, JSON, Math, Date, String, Number, Array, Object, RegExp, parseInt, parseFloat, isNaN, isFinite, Error, Promise, Map, Set, WeakMap, WeakSet, decodeURI, encodeURI, encodeURIComponent, decodeURIComponent, btoa, atob, Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray } = sandbox;

      return Promise.race([
        (async () => {
          try {
            ${source}
          } catch (e) {
            return '// TOOL ERROR: ' + (e.message || e);
          }
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Tool timeout (30s)')), 30000))
      ]);
    `);

    return {
      desc: `[${name}]`,
      requires: requires,
      run: (args) => compiled(args, sandbox),
    };
  }

  // ==============================================================
  // MCP MANAGEMENT
  // ==============================================================

  /**
   * Start an MCP server subprocess.
   */
  async startMCPServer(skillId, config) {
    const info = this.installed.get(skillId);
    if (!info) throw new Error(`Skill "${skillId}" not installed`);

    if (typeof window.electronAPI?.mcp?.start !== 'function') {
      throw new Error('MCP is only available in Electron (not browser mode)');
    }

    const result = await window.electronAPI.mcp.start(skillId, {
      command: config.command,
      args: Array.isArray(config.args) ? config.args : [],
      env: config.env || {},
    });

    if (result && result.tools) {
      // Register MCP tools in PluginManager under skillId namespace
      for (const [toolName, toolDef] of Object.entries(result.tools)) {
        const fullName = skillId + '.' + toolName;
        this.pm.registerTool(fullName, {
          desc: toolDef.desc || `[MCP:${skillId}] ${toolName}`,
          run: async (args) => {
            const ea = window.electronAPI;
            if (!ea?.mcp?.call) return '// MCP not available';
            const res = await ea.mcp.call(skillId, toolName, args);
            return typeof res === 'string' ? res : JSON.stringify(res);
          }
        });
      }
    }

    info.mcpProcess = { config, tools: result?.tools || {}, pid: result?.pid };
    return result;
  }

  async stopMCPServer(skillId) {
    const info = this.installed.get(skillId);
    if (!info || !info.mcpProcess) return;

    if (typeof window.electronAPI?.mcp?.stop === 'function') {
      await window.electronAPI.mcp.stop(skillId);
    }

    // Unregister MCP tools
    if (info.mcpProcess.tools) {
      for (const toolName of Object.keys(info.mcpProcess.tools)) {
        this.pm.tools.delete(skillId + '.' + toolName);
      }
    }
    info.mcpProcess = null;
  }

  async callMCPTool(skillId, toolName, args) {
    const ea = window.electronAPI;
    if (!ea?.mcp?.call) return '// MCP not available';
    const res = await ea.mcp.call(skillId, toolName, args);
    return typeof res === 'string' ? res : JSON.stringify(res);
  }

  // ==============================================================
  // SKILL PROMPT INJECTION
  // ==============================================================

  getSkillPrompts() {
    if (!window._skillPrompts) return '';
    const prompts = [];
    for (const [skillId, prompt] of Object.entries(window._skillPrompts)) {
      prompts.push(`[SKILL: ${skillId}]\n${prompt}`);
    }
    return prompts.join('\n\n---\n\n');
  }

  // ==============================================================
  // RELOAD (after restart)
  // ==============================================================

  async _reloadSkill(entry) {
    // Try to rehydrate from stored skill
    try {
      const ea = window.electronAPI;
      const skillKey = 'skill_data_' + entry.id;
      let skillData = null;
      if (ea?.store?.get) skillData = await ea.store.get(skillKey);
      if (!skillData) {
        try { skillData = JSON.parse(localStorage.getItem(skillKey) || 'null'); } catch {}
      }
      if (skillData && skillData.meta && skillData.tools) {
        await this.install(entry.id, skillData.meta, skillData.toolSources || {}, skillData.skillPrompt || '');
      }
    } catch (e) {
      console.warn('[SkillRegistry] Could not reload skill:', entry.id, e);
    }
  }
}

// ─── Permission whitelist ──────────────────────────────────────
const AVAILABLE_PERMISSIONS = new Set([
  'fs_read',
  'fs_write',
  'run_command',
  'network',
]);

// ─── Global instance ───────────────────────────────────────────
window.skillRegistry = new SkillRegistry(window.pluginManager);
