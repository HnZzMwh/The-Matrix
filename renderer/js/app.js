// ============================================================
// APP — Bootstrap & Global State
// ============================================================

let userAvatarGenerated = false;

async function enterWhiteRoom() {
  document.getElementById('white-room').classList.add('active');
  initAgents();

  // Task 3: Initialize the current session before the app starts rendering chats
  await initCurrentSession(agents, agents[0] && agents[0].id);
  hydrateAgentStatesFromCurrentSession();

  // Restore the last active agent from session
  currentAgentId = getCurrentSession()?.lastActiveAgentId || (agents[0] && agents[0].id) || null;
  if (currentAgentId) selectAgent(currentAgentId);

  renderSessionsRight();
  startMatrixRain();
  // Migrate old localStorage chats to IndexedDB (fire & forget)
  setTimeout(() => migrateLocalStorageToIndexedDB(), 100);
  // Sync runtime data to disk and start periodic auto-sync
  setTimeout(() => { syncRuntimeToDisk(); startAutoSync(); }, 500);
  // Recover IndexedDB chats to disk (if not already synced)
  setTimeout(() => recoverChatsFromIndexedDB(), 2000);

  // Auto-start saved MCP servers (delay to ensure all modules loaded)
  setTimeout(() => autoStartMCPServers(), 3000);
  // Scan local skills/*/SKILL.md for agent prompts (delay after MCP start)
  setTimeout(() => scanSkillsDir(), 3500);
}

// ─── Auto-start saved MCP servers on boot ───────────────────
async function autoStartMCPServers() {
  if (typeof loadMCPConfigs !== 'function') return;

  // Ensure skillRegistry is initialized
  if (window.skillRegistry && !window.skillRegistry._loaded) {
    try { await window.skillRegistry.init(); } catch {}
  }

  const servers = await loadMCPConfigs();
  if (!servers || servers.length === 0) return;

  console.log('[MCP] Auto-starting', servers.length, 'saved MCP server(s)...');
  for (const cfg of servers) {
    try {
      if (typeof window.electronAPI?.mcp?.start !== 'function') {
        console.log('[MCP] electronAPI.mcp not available (browser mode?)');
        break;
      }
      const result = await window.electronAPI.mcp.start(cfg.name, {
        command: cfg.command,
        args: cfg.args || [],
      });
      if (result.success && result.tools && window.skillRegistry && window.pluginManager) {
        // Register in skillRegistry + PluginManager
        if (!window.skillRegistry.installed.has(cfg.name)) {
          await window.skillRegistry.install(cfg.name, {
            name: cfg.name, version: '1.0.0', source: 'mcp',
            description: `MCP server: ${cfg.command} ${(cfg.args||[]).join(' ')}`,
            requires: [],
          }, {}, '');
        }
        const info = window.skillRegistry.installed.get(cfg.name);
        if (info) {
          info.mcpProcess = { config: cfg, tools: result.tools, pid: result.pid };
          for (const [toolName, toolDef] of Object.entries(result.tools)) {
            const fullName = cfg.name + '.' + toolName;
            const toolDefObj = {
              desc: toolDef.desc || `[MCP:${cfg.name}] ${toolName}`,
              run: async (args) => {
                const ea = window.electronAPI;
                if (!ea?.mcp?.call) return '// MCP not available';
                const res = await ea.mcp.call(cfg.name, toolName, args);
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
      console.log('[MCP]', cfg.name, ':', result.success ? `OK (${Object.keys(result.tools||{}).length} tools)` : 'FAILED - ' + result.error);
      if (typeof showToast === 'function') {
        showToast(result.success ? `// MCP: ${cfg.name} ready (${Object.keys(result.tools||{}).length} tools) //` : `// MCP: ${cfg.name} FAILED - ${result.error} //`);
      }
    } catch (e) {
      console.warn('[MCP] Auto-start failed for', cfg.name, ':', e.message);
      if (typeof showToast === 'function') showToast(`// MCP: ${cfg.name} ERROR - ${e.message} //`);
    }
  }

  // No need to clear cache — tool list is now rebuilt every call
}

// ─── Scan local skills/*/SKILL.md and inject as agent prompts ──
async function scanSkillsDir() {
  if (!window.pluginManager || !window.electronAPI?.fs?.list) return;
  if (typeof window._skillPrompts === 'undefined') window._skillPrompts = {};

  const skillsRoot = 'skills';
  let entries = [];
  try {
    entries = await window.electronAPI.fs.list(skillsRoot, false);
    if (!Array.isArray(entries)) entries = [];
  } catch (e) {
    console.log('[Skills] Cannot scan skills/ dir:', e.message);
    return;
  }

  for (const entry of entries) {
    if (entry.type !== 'directory') continue;
    const dir = entry.name;
    const skillMdPath = `${skillsRoot}/${dir}/SKILL.md`;

    try {
      const result = await window.electronAPI.fs.read(skillMdPath);
      if (!result || result.error) continue;
      const content = result.content;
      if (!content) continue;

      let skillName = dir;
      let skillDesc = '';
      let body = content;

      if (content.startsWith('---')) {
        const endIdx = content.indexOf('---', 3);
        if (endIdx > 0) {
          const frontmatter = content.substring(3, endIdx).trim();
          body = content.substring(endIdx + 3).trim();
          for (const line of frontmatter.split('\n')) {
            const m = line.match(/^(\w+)\s*:\s*(.+)/);
            if (m) {
              if (m[1] === 'name') skillName = m[2].trim();
              if (m[1] === 'description') skillDesc = m[2].trim();
            }
          }
        }
      }

      const promptKey = `skill_${skillName}`;
      window._skillPrompts[promptKey] = body;
      console.log(`[Skills] Loaded local SKILL.md: ${skillName} (${dir})`);

      if (window.skillRegistry && !window.skillRegistry.installed.has(promptKey)) {
        try {
          await window.skillRegistry.install(promptKey, {
            name: skillName,
            version: '1.0.0',
            source: 'local',
            description: skillDesc || `Local skill: ${dir}`,
            requires: [],
          }, {}, body);
        } catch {}
      }
    } catch (e) {
      console.log(`[Skills] Skip ${dir}: ${e.message}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Init config UI (reads from localStorage cfg)
  initConfigUI();

  // Sessions panel toggle
  const sessionsToggle = document.getElementById('sessions-toggle');
  if (sessionsToggle) {
    let sessionsVisible = (localStorage.getItem('matrix_sessions_visible') !== '0');
    const app = document.querySelector('.app');
    const updateBtn = () => {
      sessionsToggle.textContent = sessionsVisible ? '[ WIDE ]' : '[ NARROW ]';
    };
    updateBtn();
    if (!sessionsVisible && app) app.classList.add('sessions-hidden');
    sessionsToggle.addEventListener('click', () => {
      sessionsVisible = !sessionsVisible;
      if (sessionsVisible) {
        app?.classList.remove('sessions-hidden');
      } else {
        app?.classList.add('sessions-hidden');
      }
      updateBtn();
      localStorage.setItem('matrix_sessions_visible', sessionsVisible ? '1' : '0');
    });
  }

  // Keyboard shortcuts: ESC=exit, F11=toggle fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && window.electronAPI) {
      window.electronAPI.win.close();
    }
    if (e.key === 'F11') {
      e.preventDefault();
      if (window.electronAPI) {
        window.electronAPI.win.toggleFullscreen();
      }
    }
  });
});

// Startup guide (console)
console.log('%c MATRIX UPLOAD // STARTUP GUIDE ', 'background:#000;color:#00ff41;font-size:14px;padding:4px');
console.log('%c 1. Start Ollama CPU mode:', 'color:#00ff41', '$env:OLLAMA_GPU_LAYER_COUNT=0; $env:OLLAMA_ORIGINS="*"; ollama serve');
console.log('%c 2. Load model:', 'color:#00ff41', 'ollama run qwen2.5:7b-instruct  (then Ctrl+D)');
console.log('%c 3. Start server:', 'color:#00ff41', 'python -m http.server 8080');
console.log('%c 4. Open:', 'color:#00ff41', 'http://localhost:8080/matrix-upload.html');
