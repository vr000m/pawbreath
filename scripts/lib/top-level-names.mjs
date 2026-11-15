// Top-level names of a script piece, read by V8's own parser rather than by text layout, so the browser harness can
// refuse to inline two pieces that declare the same name into its one function scope.
//
// Method: compile (never run) `(async () => { <piece>\n;\nlet a, b, ...; })` with every identifier-like word of the
// piece as a candidate. V8 rejects `let x` exactly when the piece already declares `x` in that function scope
// (function, async function, generator, class, const, let, var, destructured or multiple declarators, and `var`
// inside nested blocks, which is function scoped). Names declared only inside nested functions, and words in strings,
// comments, template literals or regex literals, never conflict. Each error names one declared name; drop it from the
// candidates and compile again until the piece compiles.
//
// Candidates: every Unicode identifier token (ID_Start/ID_Continue, `$`, `_`, ZWNJ/ZWJ and \uXXXX / \u{...}
// escapes), with escapes decoded, because V8 declares and reports the decoded name. So the candidate set covers every
// name a piece can declare. A piece that opens with a "use strict" directive makes the wrapper strict, where words
// such as arguments, eval, yield, static or interface cannot be bound; one probe per piece detects that and keeps only
// candidates bindable in the piece's own mode (a strict piece cannot declare those words either).
//
// Known limits: a piece must parse on its own inside an async function (so it cannot declare `await`, and a sloppy
// piece cannot use `yield` as an expression); sloppy-mode Annex B hoisting of a block-level function declaration is
// not reported (in strict modules it stays block scoped); collisions between pieces are checked by name only, not by
// the strictness each piece would have once flattened into one scope.
import vm from 'node:vm';

const compiles = source => { new vm.Script(source); };
const compilesOk = source => { try { compiles(source); return true; } catch { return false; } };
const bindable = new Map();
const canBind = (name, strict) => {
  const key = `${strict}:${name}`;
  if (!bindable.has(key)) bindable.set(key, compilesOk(`(async () => { ${strict ? '"use strict"; ' : ''}let ${name}; })`));
  return bindable.get(key);
};
const escape = String.raw`\\u(?:[0-9A-Fa-f]{4}|\{[0-9A-Fa-f]+\})`;
const identifier = new RegExp(String.raw`(?:[\p{ID_Start}$_]|${escape})(?:[\p{ID_Continue}$\u200C\u200D]|${escape})*`, 'gu');
const decode = word => word.replace(/\\u\{?([0-9A-Fa-f]+)\}?/g, (_, hex) => {
  const code = parseInt(hex, 16);
  return code <= 0x10FFFF ? String.fromCodePoint(code) : ' ';
});
// A decoded escape may not be an identifier character (for example \uFEFF in a string); such a word names nothing.
const plainIdentifier = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u;

export function topLevelNames(source) {
  const wrap = tail => `(async () => {\n${source}\n;\n${tail}\n})`;
  compiles(wrap(''));
  // `interface` is bindable only in sloppy code; a block keeps the probe clear of the piece's own names.
  const strict = !compilesOk(wrap('{ let interface; }'));
  const words = new Set(Array.from(source.match(identifier) || [], decode).filter(word => plainIdentifier.test(word)));
  const candidates = new Set([...words].filter(name => canBind(name, strict)));
  const declared = new Set();
  for (;;) {
    if (!candidates.size) return declared;
    try {
      compiles(wrap(`let ${[...candidates].join(', ')};`));
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
