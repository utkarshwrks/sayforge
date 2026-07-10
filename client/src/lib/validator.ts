// Deterministic static validator for SAYMAN contract source.
// Runs entirely in the browser. No network, no execution — pure string/AST-ish checks.
//
// Selling point: SAYFORGE catches the exact undefined-global bug that shipped in
// SAYMAN's own reference contracts (a bare `caller` / `state`).

export type Severity = 'fail' | 'warn';
export type Level = 'pass' | 'warn' | 'fail';

export interface Issue {
  severity: Severity;
  message: string;
  line?: number;
}

export interface ValidationResult {
  level: Level;
  issues: Issue[];
}

interface Match {
  index: number;
  line: number;
}

function lineOf(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) {
    if (code[i] === '\n') line++;
  }
  return line;
}

function findAll(code: string, re: RegExp): Match[] {
  const out: Match[] = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = r.exec(code)) !== null) {
    out.push({ index: m.index, line: lineOf(code, m.index) });
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

// Strip strings and comments so keyword checks don't fire on text inside them.
function stripStringsAndComments(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'") { state = 'sq'; out += ' '; i++; continue; }
      if (c === '"') { state = 'dq'; out += ' '; i++; continue; }
      if (c === '`') { state = 'tpl'; out += ' '; i++; continue; }
      out += c;
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue; }
      out += ' ';
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    // string states: preserve newlines for line numbers, blank out chars
    if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (state === 'sq' && c === "'") { state = 'code'; out += ' '; i++; continue; }
      if (state === 'dq' && c === '"') { state = 'code'; out += ' '; i++; continue; }
      if (state === 'tpl' && c === '`') { state = 'code'; out += ' '; i++; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
  }
  return out;
}

// Extract method bodies (best-effort) so per-method rules can be scoped.
interface MethodBlock {
  name: string;
  body: string;
  start: number; // index in stripped code of the body's opening brace
  line: number;
}

function extractMethods(stripped: string): MethodBlock[] {
  const blocks: MethodBlock[] = [];
  // Match `name(args) {` and `name: function (args) {` and `name: (args) => {`
  const headerRe =
    /(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?function\s*)?\(([^)]*)\)\s*(?:=>\s*)?\{/g;
  let m: RegExpExecArray | null;
  const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
  while ((m = headerRe.exec(stripped)) !== null) {
    const name = m[1];
    if (reserved.has(name)) continue;
    const braceIdx = stripped.indexOf('{', m.index + m[0].length - 1);
    const openIdx = stripped.lastIndexOf('{', headerRe.lastIndex - 1);
    const body = extractBalanced(stripped, openIdx);
    if (body != null) {
      blocks.push({ name, body, start: openIdx, line: lineOf(stripped, m.index) });
    }
    void braceIdx;
  }
  return blocks;
}

function extractBalanced(s: string, openBraceIdx: number): string | null {
  if (s[openBraceIdx] !== '{') return null;
  let depth = 0;
  for (let i = openBraceIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return s.slice(openBraceIdx + 1, i);
    }
  }
  return null;
}

const PRIVILEGED_RE = /mint|burn|withdraw|setowner|admin|pause|transferownership/i;

export function validateContract(rawCode: string): ValidationResult {
  const issues: Issue[] = [];
  const code = rawCode || '';
  const stripped = stripStringsAndComments(code);

  // 1. FAIL if it doesn't contain a contract/methods object (or class/flat-function form).
  const hasMethodsObject = /\bmethods\s*:/.test(stripped) || /\bcontract\s*=/.test(stripped);
  const hasClass = /\bclass\s+[A-Za-z_$]/.test(stripped);
  const hasFlatFns = /\bfunction\s+[A-Za-z_$]/.test(stripped) || extractMethods(stripped).length > 0;
  if (!hasMethodsObject && !hasClass && !hasFlatFns) {
    issues.push({
      severity: 'fail',
      message:
        'No contract found. Expected `const contract = { methods: { ... } }` (or a class / function form).',
    });
  }

  // 2. FAIL on forbidden tokens. `require(` is allowed (sandbox assertion helper);
  //    only module-style require('literal') is forbidden.
  const forbidden: Array<{ re: RegExp; label: string }> = [
    { re: /\bfetch\s*\(/, label: 'fetch(' },
    { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
    { re: /\bWebSocket\b/, label: 'WebSocket' },
    { re: /\bimport\s+/, label: 'import ' },
    { re: /\bimport\s*\(/, label: 'import(' },
    { re: /\bprocess\b/, label: 'process' },
    { re: /\bfs\b/, label: 'fs' },
    { re: /\bchild_process\b/, label: 'child_process' },
    { re: /\beval\s*\(/, label: 'eval(' },
    { re: /\bFunction\s*\(/, label: 'Function(' },
    { re: /\bglobalThis\b/, label: 'globalThis' },
    { re: /\bwindow\b/, label: 'window' },
    { re: /\bdocument\b/, label: 'document' },
    { re: /\bsetTimeout\s*\(/, label: 'setTimeout' },
    { re: /\bsetInterval\s*\(/, label: 'setInterval' },
  ];
  for (const f of forbidden) {
    for (const hit of findAll(stripped, f.re)) {
      issues.push({
        severity: 'fail',
        message: `Forbidden token "${f.label}" — not available in the SAYMAN sandbox.`,
        line: hit.line,
      });
    }
  }
  // module-style require('path')
  for (const hit of findAll(stripped, /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/)) {
    issues.push({
      severity: 'fail',
      message: 'Module-style require(\'...\') is forbidden. `require(cond, msg)` assertions are fine.',
      line: hit.line,
    });
  }

  // 3. FAIL on a bare `caller` or bare `state` (the documented undefined-global bug).
  //    Allowed: msg.caller, msg.sender, .state, getState, setState, foo.caller, obj.state.
  for (const hit of findAll(stripped, /(?<![.\w$])caller\b/)) {
    // exclude `msg.caller` (handled by lookbehind for `.`) — already excluded.
    issues.push({
      severity: 'fail',
      message: 'Bare `caller` is undefined in SAYMAN — use `msg.sender` (or `msg.caller`).',
      line: hit.line,
    });
  }
  for (const hit of findAll(stripped, /(?<![.\w$])state\b(?!\s*[:=]?\s*\()/)) {
    // Exclude property access (.state) via lookbehind; exclude getState/setState by \b boundary.
    // Also skip when it's clearly `state:` inside an object literal key? That's still a bare
    // ambient reference risk only when READ; a key definition `state:` is uncommon — flag it,
    // it's almost always the bug.
    issues.push({
      severity: 'fail',
      message: 'Bare `state` is undefined in SAYMAN — persist via getState(key) / setState(key, value).',
      line: hit.line,
    });
  }

  // 4. WARN on Math.random (non-deterministic).
  for (const hit of findAll(stripped, /\bMath\s*\.\s*random\s*\(/)) {
    issues.push({
      severity: 'warn',
      message: 'Math.random() is non-deterministic — unsafe for on-chain decisions.',
      line: hit.line,
    });
  }

  const methods = extractMethods(stripped);

  // 5. WARN on privileged method names lacking an owner guard.
  for (const mb of methods) {
    if (PRIVILEGED_RE.test(mb.name)) {
      const hasGuard = /require\s*\(\s*msg\s*\.\s*sender\s*===/.test(mb.body);
      if (!hasGuard) {
        issues.push({
          severity: 'warn',
          message: `Privileged method "${mb.name}" has no owner guard — add require(msg.sender === getState('owner'), ...).`,
          line: mb.line,
        });
      }
    }
  }

  // 6. WARN on while(true) or a loop whose bound comes from args.
  for (const hit of findAll(stripped, /while\s*\(\s*true\s*\)/)) {
    issues.push({
      severity: 'warn',
      message: 'while (true) risks the 5s execution kill — bound your loops.',
      line: hit.line,
    });
  }
  // for/while conditions referencing args.*
  for (const hit of findAll(stripped, /(for|while)\s*\([^)]*\bargs\s*\.[^)]*\)/)) {
    issues.push({
      severity: 'warn',
      message: 'Loop bound derives from `args` — an attacker-chosen size can hit the 5s kill.',
      line: hit.line,
    });
  }

  // 7. WARN if a state-changing method takes args but has no require() validation.
  for (const mb of methods) {
    const usesArgs = /\bargs\s*\./.test(mb.body) || /\bargs\b/.test(mb.body);
    const stateChanging = /\bsetState\s*\(|\btransfer\s*\(|\bemit\s*\(/.test(mb.body);
    const hasRequire = /\brequire\s*\(/.test(mb.body);
    if (stateChanging && usesArgs && !hasRequire) {
      issues.push({
        severity: 'warn',
        message: `Method "${mb.name}" mutates state from args without any require(...) input validation.`,
        line: mb.line,
      });
    }
  }

  // De-duplicate identical (message,line) pairs.
  const seen = new Set<string>();
  const deduped = issues.filter((i) => {
    const k = `${i.severity}|${i.line ?? '-'}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const hasFail = deduped.some((i) => i.severity === 'fail');
  const hasWarn = deduped.some((i) => i.severity === 'warn');
  const level: Level = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  return { level, issues: deduped };
}
