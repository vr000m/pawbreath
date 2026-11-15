// Top-level names of a script piece, read by V8's own parser rather than by text layout, so the browser harness can
// refuse to inline two pieces that declare the same name into its one function scope.
//
// Method: compile (never run) `(async () => { <piece>\n;\nlet a, b, ...; })` with every identifier-like word of the
// piece as a candidate. V8 rejects `let x` exactly when the piece already declares `x` in that function scope
// (function, async function, generator, class, const, let, var, destructured or multiple declarators, and `var`
// inside nested blocks, which is function scoped). Names declared only inside nested functions, and words in strings,
// comments, template literals or regex literals, never conflict. Each error names one declared name; drop it from the
// candidates and compile again until the piece compiles. Known limits: a piece must parse on its own inside an async
// function; sloppy-mode Annex B hoisting of a block-level function declaration is not reported (in strict modules it
// stays block scoped).
import vm from 'node:vm';

const compiles = source => { new vm.Script(source); };
const bindable = new Map();
const canBind = name => {
  if (!bindable.has(name)) {
    try { compiles(`(async () => { let ${name}; })`); bindable.set(name, true); } catch { bindable.set(name, false); }
  }
  return bindable.get(name);
};

export function topLevelNames(source) {
  const candidates = new Set([...new Set(source.match(/[A-Za-z_$][\w$]*/g) || [])].filter(canBind));
  const declared = new Set();
  for (;;) {
    if (!candidates.size) return declared;
    try {
      compiles(`(async () => {\n${source}\n;\nlet ${[...candidates].join(', ')};\n})`);
      return declared;
    } catch (error) {
      const name = /^Identifier '([^']+)' has already been declared$/.exec(error.message)?.[1];
      if (!(error instanceof SyntaxError) || !name || !candidates.has(name)) throw error;
      candidates.delete(name);
      declared.add(name);
    }
  }
}

// Throws on the first name two pieces ({label: source}) both declare at top level.
export function assertNoTopLevelCollisions(pieces) {
  const declaredBy = new Map();
  for (const [piece, source] of Object.entries(pieces)) {
    for (const name of topLevelNames(source)) {
      if (declaredBy.has(name)) throw new Error(`Harness scope collision: ${name} is declared by ${declaredBy.get(name)} and ${piece}`);
      declaredBy.set(name, piece);
    }
  }
}
