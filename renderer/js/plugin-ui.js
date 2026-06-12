/**
 * PLUGIN UI — Multi-tab side drawer for tools, skills, MCP
 */

// ─── MCP persistence helpers (global) ────────────────────────
async function loadMCPConfigs() {
  const ea = window.electronAPI;
  if (ea?.store?.get) {
    try { const r = await ea.store.get('mcp_servers'); return Array.isArray(r) ? r : []; } catch {}
  }
  try { return JSON.parse(localStorage.getItem('matrix_mcp_servers') || '[]'); } catch {}
  return [];
}

async function saveMCPConfigs(servers) {
  const ea = window.electronAPI;
  if (ea?.store?.set) {
    try { await ea.store.set('mcp_servers', servers); } catch {}
  }
  try { localStorage.setItem('matrix_mcp_servers', JSON.stringify(servers)); } catch {}
}

async function getMCPStatus(name) {
  const ea = window.electronAPI;
  if (ea?.mcp?.status) {
    try { const r = await ea.mcp.status(name); return r && r.running; } catch {}
  }
  return false;
}

async function stopMCPIfRunning(name) {
  const ea = window.electronAPI;
  if (ea?.mcp?.stop) {
    try { await ea.mcp.stop(name); } catch {}
  }
  // Also cleanup skillRegistry
  if (window.skillRegistry && window.skillRegistry.installed.has(name)) {
    const info = window.skillRegistry.installed.get(name);
    if (info?.mcpProcess?.tools) {
      for (const toolName of Object.keys(info.mcpProcess.tools)) {
        window.pluginManager?.tools?.delete(name + '.' + toolName);
      }
    }
    info.mcpProcess = null;
  }
}

// Reset all agents' tool-list cache so they see newly registered MCP tools
function clearAgentToolCache() {
  if (typeof agentStates !== 'undefined') {
    for (const st of Object.values(agentStates)) {
      if (st && st._systemPromptEmbedded) {
        st._systemPromptEmbedded = false;
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const trigger = document.getElementById('tools-trigger');
  const panel = document.getElementById('tools-panel');
  const closeBtn = document.getElementById('close-tools-btn');
  const dropZone = document.getElementById('tools-drop-zone');
  const importBtn = document.getElementById('import-md-btn');
  const fileInput = document.getElementById('mdImportInput');

  // ─── Panel toggle ───
  trigger.addEventListener('click', () => {
    const wasOpen = panel.classList.contains('tools-panel-expanded');
    panel.classList.toggle('tools-panel-collapsed');
    panel.classList.toggle('tools-panel-expanded');
    if (!wasOpen) renderInstalledTab();
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.add('tools-panel-collapsed');
    panel.classList.remove('tools-panel-expanded');
  });

  // ─── Tab switching ───
  document.querySelectorAll('.ts-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ts-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.ts-tab-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById('ts-tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
      if (tab.dataset.tab === 'installed') renderInstalledTab();
    });
  });

  // ─── IMPORT tab: drag & drop ───
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    for (const file of e.dataTransfer.files) {
      if (file.name.endsWith('.md')) await importMD(file);
    }
  });
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await importMD(file);
    e.target.value = '';
  });

  async function importMD(file) {
    const text = await file.text();
    try {
      // Detect if this is a tool MD (has ```js blocks) or a prompt MD (prose only)
      const hasCodeBlocks = /```(?:js|javascript)\n[\s\S]+?\n```/.test(text);

      if (hasCodeBlocks) {
        // Tool definition: parse into runnable tools
        await window.pluginManager.importFromMarkdown(text);
        showToast(`// TOOL IMPORTED: ${file.name} //`);
      } else {
        // Prompt-only skill: save as skill prompt for agent injection
        const skillId = file.name.replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!window._skillPrompts) window._skillPrompts = {};
        window._skillPrompts[skillId] = text;

        // Also register as a lightweight plugin so it shows in the UI
        window.pluginManager.loadPlugin('skill_' + skillId, { tools: {} });

        // Persist to skill registry
        if (window.skillRegistry) {
          await window.skillRegistry.install(skillId, {
            name: skillId, version: '1.0.0', source: 'import',
            description: 'Imported from ' + file.name + ' (' + new Date(file.lastModified).toISOString().slice(0, 10) + ')',
            requires: [],
          }, {}, text);
        }

        showToast(`// SKILL PROMPT LOADED: ${file.name} //`);
      }
      renderInstalledTab();
    } catch (e) {
      showToast(`// IMPORT FAILED: ${e.message} //`);
    }
  }

  // ─── INSTALLED Tab rendering ───
  async function renderInstalledTab() {
    const summary = document.getElementById('ts-summary');
    const list = document.getElementById('ts-plugin-list');
    const pm = window.pluginManager;
    if (!pm || !summary || !list) return;

    // Init skill registry if not yet loaded
    if (window.skillRegistry && !window.skillRegistry._loaded) {
      await window.skillRegistry.init();
    }

    const registry = window.skillRegistry;
    const plugins = pm.plugins;

    // Count only pluginManager plugins (not skill_* ones separately)
    let builtinTools = 0;
    let skillTools = 0;
    let installedSkillCount = 0;
    let mcpCount = 0;

    // Built-in plugins (non-skill_*)
    for (const [pluginId, plugin] of plugins) {
      if (pluginId.startsWith('skill_')) {
        installedSkillCount++;
        skillTools += Object.keys(plugin.tools || {}).length;
      } else {
        builtinTools += Object.keys(plugin.tools || {}).length;
      }
    }

    // MCP from skill registry
    if (registry) {
      for (const [, info] of registry.installed) {
        if (info.mcpProcess) mcpCount++;
      }
    }

    const ghCount = registry ? Array.from(registry.installed.values()).filter(i => i.source && i.source.startsWith('github:')).length : 0;

    // Summary bar
    summary.innerHTML = `
      <div class="ts-stat"><div class="ts-stat-num">${plugins.size}</div><div class="ts-stat-label">PLUGINS</div></div>
      <div class="ts-stat"><div class="ts-stat-num">${builtinTools + skillTools}</div><div class="ts-stat-label">TOOLS</div></div>
      <div class="ts-stat"><div class="ts-stat-num">${mcpCount}</div><div class="ts-stat-label">MCP</div></div>
      <div class="ts-stat"><div class="ts-stat-num">${ghCount}</div><div class="ts-stat-label">GITHUB</div></div>
    `;

    let html = '';

    // ── Built-in plugins ──
    for (const [pluginId, plugin] of plugins) {
      if (pluginId.startsWith('skill_')) continue;
      const toolKeys = Object.keys(plugin.tools || {});
      html += `<div class="ts-plugin-card">
        <div class="ts-plugin-card-hdr">
          <span class="ts-pc-name">${pluginId.toUpperCase()}</span>
          <span class="ts-pc-meta">Built-in  •  ${toolKeys.length} tools</span>
        </div>
        <div class="ts-plugin-card-body">
          <table class="ts-tool-table">
            <thead><tr><th style="width:25%">TOOL</th><th style="width:50%">DESCRIPTION</th><th style="width:25%">REQUIRES</th></tr></thead>
            <tbody>`;
      for (const [name, def] of Object.entries(plugin.tools)) {
        html += `<tr>
          <td><code>${name}</code></td>
          <td>${def.desc || '—'}</td>
          <td>—</td>
        </tr>`;
      }
      html += `</tbody></table></div></div>`;
    }

    // ── Installed skills (from skill registry) ──
    if (registry && registry.installed.size > 0) {
      for (const [skillId, info] of registry.installed) {
        const toolKeys = info.tools ? Object.keys(info.tools) : [];
        html += `<div class="ts-plugin-card">
          <div class="ts-plugin-card-hdr">
            <span class="ts-pc-name">${skillId.toUpperCase()}</span>
            <span class="ts-pc-meta">${info.source || 'manual'} • v${info.version} • ${toolKeys.length} tools</span>
            <button class="ts-uninstall-btn" data-skill="${skillId}">[ UNINSTALL ]</button>
          </div>
          <div class="ts-plugin-card-body">
            <table class="ts-tool-table">
              <thead><tr><th style="width:25%">TOOL</th><th style="width:50%">DESCRIPTION</th><th style="width:25%">REQUIRES</th></tr></thead>
              <tbody>`;
        for (const [name, def] of Object.entries(info.tools || {})) {
          const reqs = def.requires ? def.requires.join(', ') : '—';
          html += `<tr>
            <td><code>${name}</code></td>
            <td>${def.desc || '—'}</td>
            <td>${reqs}</td>
          </tr>`;
        }
        html += `</tbody></table></div></div>`;
      }
    }

    if (!html) html = '<div class="ts-empty">No plugins loaded. Install skills from GitHub or import .md files.</div>';
    list.innerHTML = html;

    // Delegate uninstall clicks
    list.querySelectorAll('.ts-uninstall-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const skillId = btn.dataset.skill;
        if (confirm(`Uninstall skill "${skillId}"?`)) {
          await registry.uninstall(skillId);
          renderInstalledTab();
          showToast('// UNINSTALLED: ' + skillId + ' //');
        }
      });
    });
  }

  // ─── GITHUB tab: fetch & install ───
  document.getElementById('ts-gh-fetch-btn').addEventListener('click', async () => {
    const input = document.getElementById('ts-gh-input');
    const result = document.getElementById('ts-gh-result');
    const repo = input.value.trim();
    if (!repo) return;

    result.style.display = 'block';
    result.innerHTML = '<div class="ts-empty">Fetching <code>' + repo + '</code>…</div>';

    try {
      const registry = window.skillRegistry;
      if (!registry) throw new Error('Skill registry not available');

      const { skillId, meta, skillPrompt, toolFiles } = await registry.fetchFromGitHub(repo);

      let installBtn = '';
      if (registry.installed.has(skillId)) {
        installBtn = `<div style="color:#006622;font-size:9px;margin-top:8px">Already installed</div>`;
      } else {
        installBtn = `<button class="sw-install-btn" data-owner="${repo}" style="margin-top:8px">[ INSTALL ]</button>`;
      }

      const reqs = meta.requires ? meta.requires.join(', ') : 'none';

      result.innerHTML = `<div class="ts-gh-card">
        <div class="ts-gh-card-name">${skillId}</div>
        <div class="ts-gh-card-desc">${meta.description || '(no description)'}</div>
        <div class="ts-gh-card-meta">
          v${meta.version}  •  ⭐ ${meta.stars || 0}  •  ${meta.language || 'unknown'}
          ${meta.license ? ' • ' + meta.license : ''}
          <br>Requires: ${reqs}  •  ${toolFiles ? Object.keys(toolFiles).length : 0} tool files
        </div>
        ${skillPrompt ? '<div style="font-size:8px;color:#004400;margin-top:4px">Includes AI skill prompt (skill.md)</div>' : ''}
        ${installBtn}
      </div>`;

      // Wire install button
      const btn = result.querySelector('.sw-install-btn');
      if (btn) {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '[ INSTALLING... ]';
          try {
            await registry.installFromGitHub(repo);
            showToast('// INSTALLED: ' + skillId + ' //');
            result.innerHTML = `<div class="ts-gh-card">
              <div class="ts-gh-card-name">${skillId}</div>
              <div class="ts-gh-card-desc">✅ Installed successfully</div>
              <div class="ts-gh-card-meta">v${meta.version} • ${Object.keys(toolFiles).length} tools</div>
            </div>`;
            renderInstalledTab();
          } catch (e) {
            btn.disabled = false;
            btn.textContent = '[ INSTALL ]';
            showToast('// INSTALL FAILED: ' + e.message + ' //');
          }
        });
      }
    } catch (e) {
      result.innerHTML = '<div class="ts-empty">Error: ' + e.message + '</div>';
    }
  });

  // ─── MCP tab: add server + save config ───
  document.getElementById('ts-mcp-add-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('ts-mcp-name').value.trim();
    const cmd = document.getElementById('ts-mcp-cmd').value.trim();
    if (!name || !cmd) return showToast('// FILL BOTH FIELDS //');

    const parts = cmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    try {
      if (!window.electronAPI?.mcp) throw new Error('MCP requires Electron');

      // Save config first (so it survives restart even if start fails)
      const servers = await loadMCPConfigs();
      const existing = servers.findIndex(s => s.name === name);
      const config = { name, command, args };
      if (existing >= 0) {
        servers[existing] = config;
        await stopMCPIfRunning(name);
      } else {
        servers.push(config);
        // Also register in skillRegistry so tools show in INSTALLED tab
        if (window.skillRegistry && !window.skillRegistry.installed.has(name)) {
          await window.skillRegistry.install(name, {
            name, version: '1.0.0', source: 'mcp',
            description: `MCP server: ${command} ${args.join(' ')}`,
            requires: [],
          }, {}, '');
          window.skillRegistry.installed.get(name).mcpProcess = null; // will be filled below
        }
      }
      await saveMCPConfigs(servers);

      const result = await window.electronAPI.mcp.start(name, { command, args });
      showToast(result.success ? '// MCP STARTED: ' + name + ' //' : '// MCP FAILED: ' + result.error + ' //');

      // Update skill registry with tool info
      if (result.success && result.tools && window.skillRegistry) {
        const info = window.skillRegistry.installed.get(name);
        if (info) {
          info.mcpProcess = { config, tools: result.tools, pid: result.pid };
          // Register MCP tools in PluginManager
          for (const [toolName, toolDef] of Object.entries(result.tools)) {
            const fullName = name + '.' + toolName;
            const toolDefObj = {
              desc: toolDef.desc || `[MCP:${name}] ${toolName}`,
              run: async (args) => {
                const ea = window.electronAPI;
                if (!ea?.mcp?.call) return '// MCP not available';
                const res = await ea.mcp.call(name, toolName, args);
                if (typeof res === 'string') return res;
                if (res.error) return `// MCP error: ${res.error}`;
                if (res.images && res.images.length > 0) {
                  return { text: res.text || '', images: res.images };
                }
                return res.text || JSON.stringify(res);
              }
            };
            window.pluginManager.registerTool(fullName, toolDefObj);
            if (fullName.endsWith('.computer')) {
              window.pluginManager.registerTool('computer', {
                desc: `Alias for ${fullName} — desktop GUI control (screenshot, mouse, keyboard)`,
                run: toolDefObj.run,
              });
            }
          }
        }
      }

      // Clear inputs
      document.getElementById('ts-mcp-name').value = '';
      document.getElementById('ts-mcp-cmd').value = '';

      renderMCPServerList();
      renderInstalledTab();
      clearAgentToolCache();
    } catch (e) {
      showToast('// MCP ERROR: ' + e.message + ' //');
    }
  });

  // ─── Render saved MCP servers list ───
  async function renderMCPServerList() {
    const container = document.getElementById('ts-mcp-servers');
    if (!container) return;
    const servers = await loadMCPConfigs();
    if (servers.length === 0) {
      container.innerHTML = '<div class="ts-empty">No MCP servers configured.<br>MCP servers provide external tools via stdio IPC.<br>Add one below — it will auto-start on next launch.</div>';
      return;
    }

    let html = '';
    for (const s of servers) {
      const status = await getMCPStatus(s.name);
      const statusClass = status ? 'running' : 'stopped';
      const statusText = status ? 'RUNNING' : 'STOPPED';
      const restartBtn = status ? '' : `<button class="ts-mcp-btn" style="font-size:8px;padding:2px 8px" data-restart-name="${escapeHtml(s.name)}">START</button>`;
      html += `<div class="ts-mcp-item">
        <span class="ts-mcp-item-status ${statusClass}">${statusText}</span>
        <span class="ts-mcp-item-name">${escapeHtml(s.name)}</span>
        <span class="ts-mcp-item-cmd" title="${escapeHtml(s.command + ' ' + (s.args||[]).join(' '))}">${escapeHtml(s.command)} ${escapeHtml((s.args||[]).join(' '))}</span>
        ${restartBtn}
        <button class="ts-mcp-item-remove" data-remove-name="${escapeHtml(s.name)}">✕</button>
      </div>`;
    }
    container.innerHTML = html;

    // Event delegation for MCP items (prevents XSS)
    container.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-name]');
      if (removeBtn) {
        const name = removeBtn.getAttribute('data-remove-name');
        window._removeMCPServer(name);
        return;
      }
      const restartBtn = e.target.closest('[data-restart-name]');
      if (restartBtn) {
        const name = restartBtn.getAttribute('data-restart-name');
        window._restartMCPServer(name);
      }
    });
  }

  window._restartMCPServer = async (name) => {
    showToast('// STARTING MCP: ' + name + ' //');
    const servers = await loadMCPConfigs();
    const cfg = servers.find(s => s.name === name);
    if (!cfg) return showToast('// MCP config not found //');
    try {
      const result = await window.electronAPI.mcp.start(name, { command: cfg.command, args: cfg.args });
      showToast(result.success ? '// MCP STARTED: ' + name + ' //' : '// MCP FAILED: ' + result.error + ' //');
      if (result.success && result.tools && window.skillRegistry) {
        // Re-register tools
        const info = window.skillRegistry.installed.get(name);
        if (info) {
          info.mcpProcess = { config: cfg, tools: result.tools, pid: result.pid };
          for (const [toolName, toolDef] of Object.entries(result.tools)) {
            const fullName = name + '.' + toolName;
            const toolDefObj = {
              desc: toolDef.desc || `[MCP:${name}] ${toolName}`,
              run: async (args) => {
                const ea = window.electronAPI;
                if (!ea?.mcp?.call) return '// MCP not available';
                const res = await ea.mcp.call(name, toolName, args);
                if (typeof res === 'string') return res;
                if (res.error) return `// MCP error: ${res.error}`;
                if (res.images && res.images.length > 0) {
                  return { text: res.text || '', images: res.images };
                }
                return res.text || JSON.stringify(res);
              }
            };
            window.pluginManager.registerTool(fullName, toolDefObj);
            if (fullName.endsWith('.computer')) {
              window.pluginManager.registerTool('computer', {
                desc: `Alias for ${fullName} — desktop GUI control (screenshot, mouse, keyboard)`,
                run: toolDefObj.run,
              });
            }
          }
        }
      }
    } catch (e) { showToast('// MCP ERROR: ' + e.message + ' //'); }
    renderMCPServerList();
    if (typeof renderInstalledTab === 'function') renderInstalledTab();
    clearAgentToolCache();
  };

  window._removeMCPServer = async (name) => {
    if (!confirm('Remove MCP server "' + name + '"?')) return;
    await stopMCPIfRunning(name);
    const servers = await loadMCPConfigs();
    const filtered = servers.filter(s => s.name !== name);
    await saveMCPConfigs(filtered);
    // Uninstall from skillRegistry
    if (window.skillRegistry && window.skillRegistry.installed.has(name)) {
      await window.skillRegistry.uninstall(name);
    }
    renderMCPServerList();
    if (typeof renderInstalledTab === 'function') renderInstalledTab();
    showToast('// MCP REMOVED: ' + name + ' //');
  };

  // Show saved server list when switching to MCP tab
  const mcpTab = document.querySelector('.ts-tab[data-tab="mcp"]');
  if (mcpTab) {
    mcpTab.addEventListener('click', () => { setTimeout(renderMCPServerList, 100); });
  }
  // Also render on first panel open
  trigger.addEventListener('click', () => {
    setTimeout(renderMCPServerList, 100);
  });

  // ─── Skill prompt injection for agent chats ───
  window._getSkillPromptInjection = function() {
    const registry = window.skillRegistry;
    if (!registry) return '';
    return registry.getSkillPrompts();
  };
});
