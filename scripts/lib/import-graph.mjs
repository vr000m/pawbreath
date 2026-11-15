// The single parser for the app's static ES module imports, shared by the structure tests and the browser harness,
// so the module graph each of them checks or inlines is derived the same way.

// Every `import { a, b as c } from './x';` or `import './x';` at the start of a line, with the imported names.
export const staticImports = source => [...source.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?'(\.\/[^']+)';?$/gm)]
  .map(([, names = '', path]) => ({ path, names: names.split(',').map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean) }));

// Every module path ('./x') reachable from `starts` through static imports, starts included. `read` maps a path to
// its source.
export function reachableModules(read, starts) {
  const found = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    for (const { path } of staticImports(read(queue.shift()))) {
      if (!found.has(path)) { found.add(path); queue.push(path); }
    }
  }
  return found;
}
