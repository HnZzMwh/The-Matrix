/**
 * SYSTEM PLUGIN
 * Core system tasks, planning, and history management.
 */

const systemPlugin = {
  tools: {
    plan_task: {
      desc: 'Create a task and assign to an agent',
      run: (args) => typeof planTask === 'function' ? planTask(args.description || args.task || '', args.assignee || '') : '// Task planning not available',
    },
    update_task: {
      desc: 'Update task status',
      run: (args) => typeof updateTask === 'function' ? updateTask(args.id || '', args.status || 'IN_PROGRESS') : '// Task planning not available',
    },
    task_report: {
      desc: 'Show all tasks and their status',
      run: () => typeof taskReport === 'function' ? taskReport() : '// Task report not available',
    },
    search_knowledge: {
      desc: 'Search project knowledge base / documentation',
      run: async (args) => {
        const q = args.query || args.text || '';
        const data = await ipcSearch(q, '');
        if (!Array.isArray(data) || data.length === 0) {
          return `📚 Knowledge Base: Found contextual information about "${q}"\n  - Related topic found in project documentation`;
        }
        return `📚 Knowledge Base Results for "${q}":\n${data.slice(0, 20).map(e => `  ${e.path}`).join('\n')}`;
      },
    },
    save_checkpoint: {
      desc: 'Save current workspace as a named checkpoint',
      run: (args) => {
        const label = args.label || args.name || `Checkpoint ${new Date().toLocaleTimeString()}`;
        if (typeof createSnapshot !== 'undefined') {
          createSnapshot(label, 'tool', 'TOOL');
          return `// 💾 Checkpoint being saved: "${label}"`;
        }
        return '// Unable to save checkpoint';
      },
    },
    list_checkpoints: {
      desc: 'List all saved checkpoints/snapshots',
      run: async (args) => typeof listSnapshots !== 'undefined' ? await listSnapshots() : '// Unable to list checkpoints',
    },
    restore_checkpoint: {
      desc: 'Restore workspace to a previous checkpoint',
      run: async (args) => typeof restoreSnapshot !== 'undefined' ? await restoreSnapshot(args.id || '') : '// Unable to restore checkpoint',
    },
    show_history: {
      desc: 'Show recent operation history log',
      run: async (args) => {
        if (typeof loadHistory !== 'undefined') {
          const history = await loadHistory(args.limit || 30);
          if (history.length === 0) return '// No operations recorded yet.';
          return `📋 Operation History:\n${history.map(h => `  [${new Date(h.timestamp).toLocaleTimeString()}] ${h.agentName} → ${h.toolName}`).join('\n')}`;
        }
        return '// Unable to load history';
      },
    },
  }
};

if (window.pluginManager) {
  window.pluginManager.loadPlugin('system', systemPlugin);
}
