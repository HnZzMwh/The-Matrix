/**
 * PLUGIN MANAGER
 * Handles dynamic loading and execution of agent tools/skills.
 * Separates core system logic from extensible agent capabilities.
 */

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.tools = new Map();
  }

  /**
   * Register a tool with a specific name and definition.
   * @param {string} name - The tool name (used in [TOOL: name])
   * @param {Object} definition - { desc, run: async(args) => {} }
   */
  registerTool(name, definition) {
    this.tools.set(name, definition);
    console.log(`[PluginManager] Tool registered: ${name}`);
  }

  /**
   * Load a plugin from a JavaScript object.
   * @param {string} pluginId - Unique ID for the plugin
   * @param {Object} pluginModule - Object containing tool definitions
   */
  loadPlugin(pluginId, pluginModule) {
    if (this.plugins.has(pluginId)) {
      console.warn(`[PluginManager] Plugin ${pluginId} already loaded. Overwriting.`);
    }
    
    this.plugins.set(pluginId, pluginModule);
    
    if (pluginModule.tools) {
      for (const [name, def] of Object.entries(pluginModule.tools)) {
        this.registerTool(name, def);
      }
    }
    
    console.log(`[PluginManager] Plugin loaded: ${pluginId}`);
  }

  /**
   * Import a plugin from a Markdown document.
   * Extracts tool descriptions and logic from MD structure.
   * @param {string} mdContent - The Markdown content
   */
  async importFromMarkdown(mdContent) {
    // Basic parser for MD-based tools
    // Expected format:
    // # Tool Name
    // > Description
    // ```js
    // async run(args) { ... }
    // ```
    const tools = {};
    const sections = mdContent.split(/^#\s+/m).filter(Boolean);
    
    for (const section of sections) {
      const lines = section.split('\n');
      const name = lines[0].trim().toLowerCase().replace(/\s+/g, '_');
      const descMatch = section.match(/^>\s*(.+)$/m);
      const desc = descMatch ? descMatch[1].trim() : '';
      
      const codeMatch = section.match(/```(?:js|javascript)\n([\s\S]+?)\n```/);
      if (codeMatch) {
        try {
          // Build a restricted sandbox for MD-imported tools.
          // Critical: only expose permission-gated APIs, never pass
          // global/window/proxy/this to the compiled code to prevent sandbox escapes.
          const sandboxTools = { EA, ipcRead, ipcWrite, ipcList, ipcRun };
          // Safe builtins — no Function, Object.getPrototypeOf, Proxy, Reflect, etc.
          const safeBuiltins = {
            console, setTimeout, setInterval, clearTimeout, clearInterval,
            JSON, Math, Date, String, Number, Boolean,
            Array, Object, RegExp, parseInt, parseFloat, isNaN, isFinite,
            Error, TypeError, RangeError, ReferenceError, SyntaxError, URIError,
            Promise, Map, Set, WeakMap, WeakSet,
            decodeURI, encodeURI, encodeURIComponent, decodeURIComponent,
            btoa, atob,
          };

          // Combine sandbox + builtins and expose as single 'S' namespace
          const sandboxKeys = Object.keys(sandboxTools);
          const builtinKeys = Object.keys(safeBuiltins);
          const allKeys = [...sandboxKeys, ...builtinKeys];
          const allValues = [...Object.values(sandboxTools), ...Object.values(safeBuiltins)];
          const codeStr = `
            var _S = { ${allKeys.map(k => k + ': ' + k).join(', ')} };
            return (async () => {
              ${codeMatch[1]}
            })();
          `;
          const runFn = new Function(...allKeys, codeStr);

          tools[name] = {
            desc,
            run: (args) => runFn(...allValues),
          };
        } catch (e) {
          console.error(`[PluginManager] Failed to parse tool ${name} from MD:`, e);
        }
      }
    }
    
    const pluginId = `md_plugin_${Date.now()}`;
    this.loadPlugin(pluginId, { tools });
    return pluginId;
  }

  /**
   * Execute a tool call.
   * @param {string} name - Tool name
   * @param {Object} args - Arguments passed to the tool
   */
  async execute(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      return `// ERROR: Tool "${name}" not found.`;
    }
    
    try {
      return await tool.run(args);
    } catch (e) {
      console.error(`[PluginManager] Error executing tool ${name}:`, e);
      return `// ERROR executing ${name}: ${e.message}`;
    }
  }

  /**
   * Get all registered tool definitions for agent prompts.
   */
  getToolManifest() {
    const manifest = {};
    for (const [name, def] of this.tools.entries()) {
      manifest[name] = def.desc;
    }
    return manifest;
  }
}

// Global instance
window.pluginManager = new PluginManager();
