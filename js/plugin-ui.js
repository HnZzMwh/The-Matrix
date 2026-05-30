/**
 * PLUGIN UI
 * Handles tool management UI, drag-and-drop, and MD importing.
 */

document.addEventListener('DOMContentLoaded', () => {
  const trigger = document.getElementById('tools-trigger');
  const panel = document.getElementById('tools-panel');
  const closeBtn = document.getElementById('close-tools-btn');
  const dropZone = document.getElementById('tools-drop-zone');
  const importBtn = document.getElementById('import-md-btn');
  const fileInput = document.getElementById('mdImportInput');
  const toolList = document.getElementById('active-tools-list');

  // Toggle panel
  trigger.addEventListener('click', () => {
    panel.classList.toggle('tools-panel-collapsed');
    panel.classList.toggle('tools-panel-expanded');
    renderActiveTools();
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.add('tools-panel-collapsed');
    panel.classList.remove('tools-panel-expanded');
  });

  // Drag & Drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    for (const file of files) {
      if (file.name.endsWith('.md')) {
        await importMD(file);
      }
    }
  });

  // Manual Import
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await importMD(file);
    e.target.value = '';
  });

  async function importMD(file) {
    const text = await file.text();
    try {
      const pluginId = await window.pluginManager.importFromMarkdown(text);
      showToast(`// SKILL IMPORTED: ${file.name} //`);
      renderActiveTools();
    } catch (e) {
      showToast(`// IMPORT FAILED: ${e.message} //`);
    }
  }

  function renderActiveTools() {
    if (!window.pluginManager) return;
    const tools = window.pluginManager.getToolManifest();
    let html = '';
    
    // Group tools by plugin
    const plugins = window.pluginManager.plugins;
    for (const [pluginId, plugin] of plugins.entries()) {
      html += `<div class="plugin-group">
        <div class="plugin-name">// PLUGIN: ${pluginId.toUpperCase()} //</div>
        <div class="plugin-tools">`;
      
      if (plugin.tools) {
        for (const [name, def] of Object.entries(plugin.tools)) {
          html += `<div class="tool-item" title="${def.desc}">
            <span class="tool-name">${name}</span>
            <span class="tool-desc">${def.desc.slice(0, 50)}${def.desc.length > 50 ? '...' : ''}</span>
          </div>`;
        }
      }
      
      html += `</div></div>`;
    }
    
    toolList.innerHTML = html || '<div class="no-tools">// NO PLUGINS LOADED //</div>';
  }
});
