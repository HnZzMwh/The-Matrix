﻿/**
 * FILESYSTEM PLUGIN
 * Core file and directory operations.
 */

// ─── HTML attribute sanitizer ──────────────────────────────
const HTML_ATTRS = new Set(['lang','charset','id','class','style','type','src','href','rel','name','value','width','height','alt','title','target','role','dir','hidden','disabled','readonly','placeholder','autocomplete','spellcheck','draggable','contenteditable','tabindex','accesskey','translate']);

function sanitizeToolParams(params) {
  const cleaned = {};
  for (const [k, v] of Object.entries(params)) {
    if (!HTML_ATTRS.has(k)) cleaned[k] = v;
  }
  return cleaned;
}

const filesystemPlugin = {
  tools: {
    read_file: {
      desc: 'Read file content from real disk (project root only)',
      run: async (args) => {
        const path = args.path || args.file || args._;
        if (!path) return '// Usage: [TOOL: read_file path="E:\\path\\to\\file"]';
        const data = await ipcReadSafe(path);
        return data.error ? `// ERROR: ${data.error}` : data.content;
      },
    },
    write_file: {
      desc: 'Write content to a file on real disk (requires whitelist)',
      run: async (args) => {
        const cleaned = sanitizeToolParams(args);
        const path = cleaned.path || cleaned.file;
        if (!path) return '// Usage: [TOOL: write_file path="E:\\path\\to\\file" content="..."]';
        const content = cleaned.content || '';
        if (!content) {
          return '// ERROR: write_file needs a "content" parameter with the file text.\n// Got these parameters: [' + Object.keys(args).join(', ') + ']\n// Correct usage: [TOOL: write_file path="file.txt" content=\'your text here\']\n// Do NOT add HTML attributes like lang, charset, id, class.';
        }
        if (typeof isPathWhitelisted !== 'function' || !isPathWhitelisted(path)) {
          return `// BLOCKED: "${path}" not in write whitelist.`;
        }
        const data = await ipcWriteSafe(path, content);
        if (data.success) {
          if (typeof triggerFileBrowserRefresh === 'function') triggerFileBrowserRefresh();
          return `// Written ${data.size} bytes to ${data.path}`;
        }
        return `// ERROR: ${data.error || 'write failed'}`;
      },
    },
    repo_scan: {
      desc: 'Scan repository structure — list files in any readable directory',
      run: async (args) => {
        const path = args.path || args.dir || '';
        const data = await ipcList(path, true);
        if (!Array.isArray(data)) return `// Cannot access: ${data.error || path || '(root)'}`;
        const dirs = {};
        for (const e of data) {
          const dir = e.folder || '';
          if (!dirs[dir]) dirs[dir] = [];
          dirs[dir].push(e.name);
        }
        const lines = [];
        for (const [dir, files] of Object.entries(dirs)) {
          lines.push(`${dir || '.'}/`);
          for (const f of files) lines.push(`  ${f}`);
        }
        return `📁 Repository scan: ${data.length} items\n${lines.join('\n').slice(0, 5000)}`;
      },
    },
    repo_tree: {
      desc: 'Show full directory tree of a path',
      run: async (args) => {
        const path = args.path || args.dir || '.';
        const data = await ipcList(path, false);
        if (!Array.isArray(data)) return `// Cannot access: ${path}`;
        const lines = [`📂 ${path}`];
        for (const e of data) {
          if (e.name === '.') continue;
          lines.push(`  ${e.type === 'dir' || e.type === 'drive' ? '📁' : '📄'} ${e.name}`);
        }
        return lines.join('\n').slice(0, 3000);
      },
    },
    list_dir: {
      desc: 'List files in a directory',
      run: async (args) => {
        const data = await ipcList(args.path || '.', false);
        if (data.error) return `// ERROR: ${data.error}`;
        if (!Array.isArray(data) || data.length === 0) return '// (empty directory)';
        return data.map(e => `  ${e.type === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n');
      },
    },
    delete_file: {
      desc: 'Delete a file (uses empty write to overwrite)',
      run: async (args) => {
        const path = args.path || args.file;
        if (!path) return '// Provide a file path';
        if (typeof isPathWhitelisted !== 'function' || !isPathWhitelisted(path)) return `// BLOCKED: "${path}" not in whitelist.`;
        const data = await ipcWriteSafe(path, '');
        return data.success ? `// Deleted (overwritten) ${path}` : `// ERROR: ${data.error}`;
      },
    },
    read_multiple: {
      desc: 'Read multiple files at once (project root only)',
      run: async (args) => {
        const paths = (args.paths || args.files || '').split(',').map(s => s.trim()).filter(Boolean);
        const results = [];
        for (const p of paths) {
          const d = await ipcReadSafe(p);
          results.push(`=== ${p} ===\n${d.error ? `// ERROR: ${d.error}` : d.content}`);
        }
        return results.join('\n\n');
      },
    },
  }
};

if (window.pluginManager) {
  window.pluginManager.loadPlugin('filesystem', filesystemPlugin);
}
