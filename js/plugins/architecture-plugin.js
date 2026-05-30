/**
 * ARCHITECTURE PLUGIN
 * Tools for architecture memory, ownership, and symbol analysis.
 */

const architecturePlugin = {
  tools: {
    save_arch_rules: {
      desc: 'Save architecture rules: tech stack, module boundaries, coding conventions, API style',
      run: async (args) => {
        if (typeof setTechStack === 'undefined') return '// Architecture memory not available';
        if (args.techStack) {
          try {
            const stack = JSON.parse(args.techStack);
            await setTechStack(stack);
            return `// Tech stack updated: ${Object.entries(stack).map(([k,v]) => `${k}=${v}`).join(', ')}`;
          } catch (e) { return `// ERROR parsing techStack JSON: ${e.message}`; }
        }
        if (args.moduleBoundary) {
          try {
            const allowed = (args.allowedImports || '').split(',').map(s => s.trim()).filter(Boolean);
            const forbidden = (args.forbiddenImports || '').split(',').map(s => s.trim()).filter(Boolean);
            await saveModuleBoundary(args.moduleBoundary, allowed, forbidden, args.description || '');
            return `// Module boundary saved: ${args.moduleBoundary}`;
          } catch (e) { return `// ERROR: ${e.message}`; }
        }
        if (args.adr) {
          try {
            const adr = await saveArchDecision(args.adr, args.reason || '', args.author || 'AGENT');
            return `// ADR saved: ${adr.id} — ${args.adr}`;
          } catch (e) { return `// ERROR: ${e.message}`; }
        }
        if (args.owner && args.pattern) {
          try {
            const entry = await setFileOwnership(args.pattern, args.owner, args.description || '');
            return `// File ownership set: ${entry.pattern} → ${entry.owner}`;
          } catch (e) { return `// ERROR: ${e.message}`; }
        }
        if (args.debt) {
          try {
            const debt = await addTechDebt(args.debt, args.severity || 'medium', args.location || '', args.author || 'AGENT');
            return `// Tech debt recorded: ${debt.id} — ${args.debt.slice(0, 60)}`;
          } catch (e) { return `// ERROR: ${e.message}`; }
        }
        if (args.schema) {
          try {
            const fields = args.fields || '[]';
            const parsed = typeof fields === 'string' ? JSON.parse(fields) : fields;
            const schema = await saveSchema(args.schema, parsed, args.description || '', parseInt(args.version) || 1);
            return `// Schema saved: ${schema.name} v${schema.version} (${schema.fields.length} fields)`;
          } catch (e) { return `// ERROR: ${e.message}`; }
        }
        return '// Usage: techStack={...} or moduleBoundary="..." or adr="..." or owner="anderson" pattern="backend/*" or debt="..." or schema="Todo" fields=\'[{"name":"id","type":"int"}]\'';
      },
    },
    query_arch: {
      desc: 'Query architecture memory',
      run: async (args) => {
        if (typeof queryArchMemory === 'undefined') return '// Architecture memory not available';
        const q = args.query || args.q || '';
        if (!q) {
          if (typeof archSummary !== 'undefined') return await archSummary();
          return '// Provide a query string';
        }
        const result = await queryArchMemory(q);
        return `🔍 Architecture Query: "${q}"\n${result}`;
      },
    },
    check_arch_violation: {
      desc: 'Check if a file path violates defined module boundary rules',
      run: async (args) => {
        if (typeof checkArchViolation === 'undefined') return '// Architecture memory not available';
        const filePath = args.path || args.file || '';
        if (!filePath) return '// Provide a file path';
        const result = await checkArchViolation(filePath);
        return result || `// No architecture violations for "${filePath}"`;
      },
    },
    check_ownership: {
      desc: 'Check if an agent is allowed to modify a file based on ownership rules',
      run: async (args) => {
        const filePath = args.path || args.file || '';
        const agentId = args.agent || args.id || '';
        if (!filePath) return '// Usage: [TOOL: check_ownership path="src/app.js" agent="anderson"]';
        if (typeof checkOwnership === 'undefined') return '// Ownership system not available';
        const result = await checkOwnership(filePath, agentId);
        return result || `✓ "${filePath}" is owned by or unassigned — ${agentId} may modify.`;
      },
    },
    build_symbol_graph: {
      desc: 'Build a symbol dependency graph for files in a directory',
      run: async (args) => {
        const path = args.path || args.dir || '';
        if (!path) return '// Usage: [TOOL: build_symbol_graph path="E:\\project\\src"]';
        if (typeof buildSymbolGraph === 'undefined') return '// Symbol graph builder not available';
        try {
          const graph = await buildSymbolGraph([path]);
          let out = `📊 Symbol Graph for ${path}\n\n`;
          let totalSymbols = 0;
          for (const [file, symbols] of Object.entries(graph.symbols)) {
            if (symbols.length === 0) continue;
            totalSymbols += symbols.length;
            out += `📄 ${file.split(/[\\/]/).pop()}\n`;
            for (const s of symbols.slice(0, 10)) {
              out += `  ├─ ${s.name} (L${s.line})\n`;
            }
            if (symbols.length > 10) out += `  └─ ... ${symbols.length - 10} more\n`;
          }
          out += `\n${Object.keys(graph.symbols).length} files, ${totalSymbols} symbols`;
          return out.slice(0, 4000);
        } catch (e) {
          return `// ERROR: ${e.message}`;
        }
      },
    },
    relevant_context: {
      desc: 'Find only the files relevant to a task',
      run: async (args) => {
        const target = args.target || args.file || args.symbol || '';
        const basePath = args.path || '';
        if (!target) return '// Usage: [TOOL: relevant_context target="app.py" path="E:\\project\\src"]';
        if (typeof buildSymbolGraph === 'undefined') return '// Context retrieval not available';
        try {
          const scanPath = basePath || '.';
          const graph = await buildSymbolGraph([scanPath]);
          const relevant = new Set();
          for (const [file, symbols] of Object.entries(graph.symbols)) {
            if (file.toLowerCase().includes(target.toLowerCase())) relevant.add(file);
            for (const s of symbols) {
              if (s.name.toLowerCase() === target.toLowerCase()) relevant.add(file);
            }
          }
          if (relevant.size === 0) return `// No relevant files found for "${target}".`;
          let out = `🎯 Relevant context for "${target}" (${relevant.size} files):\n`;
          relevant.forEach(f => out += `  ${f}\n`);
          return out;
        } catch (e) { return `// ERROR: ${e.message}`; }
      },
    },
    cross_file_check: {
      desc: 'Check if an API/schema change has corresponding updates in dependent files',
      run: async (args) => {
        const filePath = args.path || args.file || args.api || '';
        const field = args.field || args.symbol || '';
        if (!filePath) return '// Usage: [TOOL: cross_file_check path="backend/api.py" field="completed_at"]';
        if (typeof buildSymbolGraph === 'undefined') return '// Cross-file check not available';
        try {
          const dir = filePath.split(/[\\/]/).slice(0, -1).join('\\') || '.';
          const graph = await buildSymbolGraph([dir]);
          const fileName = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
          const affected = [];
          for (const [file, imports] of Object.entries(graph.imports)) {
            for (const imp of imports) {
              if (imp.source.includes(fileName)) affected.push(file);
            }
          }
          let out = `🔄 Cross-file analysis for ${filePath}\n`;
          if (affected.length > 0) {
            out += `\nFiles that import from ${fileName} (may need updates):\n`;
            affected.forEach(f => out += `  ⚠ ${f}\n`);
          } else {
            out += `\n✓ No files directly import from ${fileName}.\n`;
          }
          return out;
        } catch (e) { return `// ERROR: ${e.message}`; }
      },
    },
    acquire_lock: {
      desc: 'Acquire an exclusive write lock on a file before editing',
      run: (args) => {
        const path = args.path || args.file || '';
        const agentId = args.agent || args.id || 'unknown';
        if (!path) return '// Usage: [TOOL: acquire_lock path="backend/app.py" agent="anderson"]';
        if (typeof acquireFileLock !== 'function') return '// File locking not available';
        const result = acquireFileLock(path, agentId);
        return result.ok ? `🔒 ${result.message}` : `🔴 ${result.message}`;
      },
    },
    release_lock: {
      desc: 'Release a file lock after editing is complete',
      run: (args) => {
        const path = args.path || args.file || '';
        const agentId = args.agent || args.id || 'unknown';
        if (!path) return '// Usage: [TOOL: release_lock path="backend/app.py" agent="anderson"]';
        if (typeof releaseFileLock !== 'function') return '// File lock release not available';
        const result = releaseFileLock(path, agentId);
        return result.ok ? `🔓 ${result.message}` : `🔴 ${result.message}`;
      },
    },
    request_ownership: {
      desc: 'Request patch permission from a file owner',
      run: (args) => {
        const filePath = args.path || args.file || '';
        const owner = args.owner || args.target || '';
        const reason = args.reason || args.why || '';
        const requester = args.agent || args.from || 'unknown';
        if (!filePath || !owner) return '// Usage: [TOOL: request_ownership path="backend/app.py" owner="anderson" reason="..."]';
        if (typeof requestEscalation !== 'function') return '// Escalation system not available';
        const req = requestEscalation(requester, owner, filePath, reason);
        return `📨 Escalation ${req.id}: ${requester} → ${owner}: "${reason}" (pending)`;
      },
    },
    my_pending_requests: {
      desc: 'Show pending ownership escalation requests for your agent',
      run: (args) => {
        const agentId = args.agent || args.id || 'unknown';
        if (typeof getPendingEscalations !== 'function') return '// Escalation system not available';
        const pending = getPendingEscalations(agentId);
        if (pending.length === 0) return `✓ No pending escalation requests for ${agentId}.`;
        return `📨 Pending requests for ${agentId}:\n` + pending.map(r =>
          `  ${r.id}: ${r.requester} wants to edit ${r.filePath} — "${r.reason}"`
        ).join('\n');
      },
    },
    call_graph: {
      desc: 'Build a call graph for a function',
      run: async (args) => {
        const symbol = args.symbol || args.name || args.func || '';
        const basePath = args.path || args.dir || '';
        if (!symbol) return '// Usage: [TOOL: call_graph symbol="get_todos" path="..."]';
        if (typeof buildSymbolGraph !== 'function') return '// Symbol graph not available';
        try {
          const scanPath = basePath || '.';
          const graph = await buildSymbolGraph([scanPath]);
          const callers = [];
          for (const [file, symbols] of Object.entries(graph.symbols)) {
            for (const s of symbols) {
              if (s.name === symbol) callers.push({ file, line: s.line });
            }
          }
          let out = `🔄 Call Graph for "${symbol}"\n\n`;
          if (callers.length > 0) {
            out += `⬆ Callers (who uses it):\n`;
            callers.forEach(c => out += `  ${c.file}:${c.line}\n`);
          } else {
            out += `  No call relationships found for "${symbol}".`;
          }
          return out;
        } catch (e) { return `// ERROR: ${e.message}`; }
      },
    },
  }
};

if (window.pluginManager) {
  window.pluginManager.loadPlugin('architecture', architecturePlugin);
}
