export type SymbolKind = 'label' | 'alias';

export type RegisterClass = 'sgpr' | 'vgpr' | 'agpr' | 'special' | 'expr';

export interface AssemblySymbol {
  name: string;
  kind: SymbolKind;
  /** 0-based line number */
  line: number;
  /** 0-based start column of the symbol name */
  startCol: number;
  /** 0-based exclusive end column of the symbol name */
  endCol: number;
  /** For aliases: .set, .equ, .equiv, .eqv, =, #define */
  directive?: string;
  /** Raw RHS expression for aliases */
  expression?: string;
  /** Inferred register class for aliases */
  registerClass?: RegisterClass;
}

export interface WordAtPosition {
  word: string;
  line: number;
  startCol: number;
  endCol: number;
}

export interface ParsedDocument {
  symbols: AssemblySymbol[];
  byName: Map<string, AssemblySymbol[]>;
  /** Lines with comments and strings masked by spaces (preserving offsets) */
  maskedLines: string[];
}

const IDENT_CHAR_RE = /[A-Za-z0-9_.$]/;
const IDENT_START_RE = /[A-Za-z_.$]/;

/**
 * Masks comments (//, ;, /* ... *\/) and string literals ("...", '...') with spaces
 * while preserving exact line count and character offsets.
 */
export function maskCommentsAndStrings(text: string): string[] {
  const len = text.length;
  const out = new Array<string>(len);
  let i = 0;
  let inBlockComment = false;

  while (i < len) {
    const ch = text[i];
    const next = i + 1 < len ? text[i + 1] : '';

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
        inBlockComment = false;
      } else {
        out[i] = ch === '\n' || ch === '\r' ? ch : ' ';
        i++;
      }
      continue;
    }

    // Start of block comment
    if (ch === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      inBlockComment = true;
      continue;
    }

    // Line comments: // or ;
    if ((ch === '/' && next === '/') || ch === ';') {
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    // String literals: "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i] = ' ';
      i++;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        if (text[i] === '\\' && i + 1 < len && text[i + 1] !== '\n' && text[i + 1] !== '\r') {
          out[i] = ' ';
          out[i + 1] = ' ';
          i += 2;
          continue;
        }
        const cur = text[i];
        out[i] = ' ';
        i++;
        if (cur === quote) {
          break;
        }
      }
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join('').split(/\r?\n/);
}

/**
 * Masks only comments (keeping strings intact) for extracting clean RHS expressions.
 */
function stripLineComment(rawLine: string, maskedLine: string): string {
  // Find where the masked line still has non-space content; use maskedLine length
  return maskedLine.trim();
}

export function classifyRegisterExpression(expr: string): RegisterClass {
  const trimmed = expr.trim();
  if (/^s(?:\d+|\s*\[)/i.test(trimmed)) return 'sgpr';
  if (/^v(?:\d+|\s*\[)/i.test(trimmed)) return 'vgpr';
  if (/^a(?:\d+|\s*\[)/i.test(trimmed)) return 'agpr';
  if (/^(?:ttmp(?:\d+|\s*\[)|vcc|exec|scc|m0|null|off|flat_scratch)/i.test(trimmed)) {
    return 'special';
  }
  return 'expr';
}

const LABEL_DEF_RE = /^(\s*)([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:(?!\s*=)/;
const SET_DIRECTIVE_RE = /^(\s*)(\.(?:set|equ|equiv|eqv))\s+([A-Za-z_.$][A-Za-z0-9_.$]*)\s*,\s*(.+?)\s*$/i;
const ASSIGN_DEF_RE = /^(\s*)([A-Za-z_.$][A-Za-z0-9_.$]*)\s*=(?!=)\s*(.+?)\s*$/;
const DEFINE_RE = /^(\s*)(#\s*define)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?(?:\s+(.*?))?\s*$/;

/**
 * Parses an AMD GCN/CDNA/RDNA assembly document for label and alias definitions.
 */
export function parseDocument(text: string): ParsedDocument {
  const rawLines = text.split(/\r?\n/);
  const maskedLines = maskCommentsAndStrings(text);
  const symbols: AssemblySymbol[] = [];
  const byName = new Map<string, AssemblySymbol[]>();

  const addSymbol = (sym: AssemblySymbol) => {
    symbols.push(sym);
    const list = byName.get(sym.name);
    if (list) {
      list.push(sym);
    } else {
      byName.set(sym.name, [sym]);
    }
  };

  for (let lineIdx = 0; lineIdx < maskedLines.length; lineIdx++) {
    const masked = maskedLines[lineIdx];
    if (!masked.trim()) continue;

    // 1. #define NAME expr
    const defMatch = masked.match(DEFINE_RE);
    if (defMatch) {
      const name = defMatch[3];
      const prefixLen = defMatch[1].length + defMatch[2].length;
      const nameIdx = masked.indexOf(name, prefixLen);
      const expr = (defMatch[4] || '').trim();
      addSymbol({
        name,
        kind: 'alias',
        directive: '#define',
        expression: expr,
        registerClass: classifyRegisterExpression(expr),
        line: lineIdx,
        startCol: nameIdx,
        endCol: nameIdx + name.length,
      });
      continue;
    }

    // 2. .set / .equ / .equiv / .eqv name, expr
    const setMatch = masked.match(SET_DIRECTIVE_RE);
    if (setMatch) {
      const directive = setMatch[2].toLowerCase();
      const name = setMatch[3];
      const prefixLen = setMatch[1].length + setMatch[2].length;
      const nameIdx = masked.indexOf(name, prefixLen);
      const expr = setMatch[4].trim();
      addSymbol({
        name,
        kind: 'alias',
        directive,
        expression: expr,
        registerClass: classifyRegisterExpression(expr),
        line: lineIdx,
        startCol: nameIdx,
        endCol: nameIdx + name.length,
      });
      continue;
    }

    // 3. Label definition: label_name: (may be followed by an instruction on the same line)
    const labelMatch = masked.match(LABEL_DEF_RE);
    if (labelMatch) {
      const name = labelMatch[2];
      // Avoid matching directives that happen to be followed by ':' (none standard, but safe guard)
      const startCol = labelMatch[1].length;
      addSymbol({
        name,
        kind: 'label',
        line: lineIdx,
        startCol,
        endCol: startCol + name.length,
      });
      // Do not continue; though rare, a label could be followed by `.set` on the same line? No, standard asm puts statements on new lines.
      continue;
    }

    // 4. Assignment alias: name = expr
    const assignMatch = masked.match(ASSIGN_DEF_RE);
    if (assignMatch) {
      const name = assignMatch[2];
      const startCol = assignMatch[1].length;
      const expr = stripLineComment(rawLines[lineIdx] || '', assignMatch[3]);
      addSymbol({
        name,
        kind: 'alias',
        directive: '=',
        expression: expr,
        registerClass: classifyRegisterExpression(expr),
        line: lineIdx,
        startCol,
        endCol: startCol + name.length,
      });
    }
  }

  return { symbols, byName, maskedLines };
}

/**
 * Extracts the identifier at (line, col) from the masked document lines.
 * Returns undefined if the cursor is inside a comment, string, or non-identifier token.
 */
export function getWordAtPosition(
  maskedLines: string[],
  line: number,
  col: number
): WordAtPosition | undefined {
  if (line < 0 || line >= maskedLines.length) {
    return undefined;
  }
  const text = maskedLines[line];
  if (col < 0 || col > text.length) {
    return undefined;
  }

  // If cursor is right at the end of a word (col === text.length or non-ident char), check col - 1
  let pos = col;
  if (pos === text.length || !IDENT_CHAR_RE.test(text[pos])) {
    if (pos > 0 && IDENT_CHAR_RE.test(text[pos - 1])) {
      pos = pos - 1;
    } else {
      return undefined;
    }
  }

  let start = pos;
  while (start > 0 && IDENT_CHAR_RE.test(text[start - 1])) {
    start--;
  }

  let end = pos + 1;
  while (end < text.length && IDENT_CHAR_RE.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end);
  if (!word || !IDENT_START_RE.test(word[0])) {
    return undefined;
  }

  return { word, line, startCol: start, endCol: end };
}

/**
 * Finds the best matching definition(s) for `name` referenced at `currentLine`.
 *
 * Rules:
 * - Labels: can be forward- or backward-referenced, so all matching label definitions are returned.
 * - Aliases: if redefined multiple times, prefers the nearest preceding definition
 *   (line <= currentLine). If only defined after currentLine, returns the first definition.
 */
export function findDefinitions(
  parsed: ParsedDocument,
  name: string,
  currentLine: number
): AssemblySymbol[] {
  const candidates = parsed.byName.get(name);
  if (!candidates || candidates.length === 0) {
    return [];
  }

  const labels = candidates.filter((c) => c.kind === 'label');
  const aliases = candidates.filter((c) => c.kind === 'alias');

  if (labels.length > 0 && aliases.length === 0) {
    return labels;
  }

  if (aliases.length > 0) {
    const preceding = aliases.filter((a) => a.line <= currentLine);
    const bestAlias =
      preceding.length > 0 ? preceding[preceding.length - 1] : aliases[0];
    if (labels.length === 0) {
      return [bestAlias];
    }
    return [bestAlias, ...labels];
  }

  return [];
}

/**
 * Evaluates simple integer arithmetic expressions like "4+3", "16 - 1", "2 * 4".
 */
function tryEvalSimpleIntExpr(expr: string): number | undefined {
  const cleaned = expr.trim();
  if (!/^[0-9+\-*\s()]+$/.test(cleaned)) {
    return undefined;
  }
  // Safe recursive-descent evaluator for +, -, *, parentheses, and non-negative integers
  let idx = 0;
  const skipWs = () => {
    while (idx < cleaned.length && /\s/.test(cleaned[idx])) idx++;
  };
  const parseExpr = (): number | undefined => {
    let left = parseTerm();
    if (left === undefined) return undefined;
    while (true) {
      skipWs();
      if (cleaned[idx] === '+') {
        idx++;
        const right = parseTerm();
        if (right === undefined) return undefined;
        left += right;
      } else if (cleaned[idx] === '-') {
        idx++;
        const right = parseTerm();
        if (right === undefined) return undefined;
        left -= right;
      } else {
        break;
      }
    }
    return left;
  };
  const parseTerm = (): number | undefined => {
    let left = parseFactor();
    if (left === undefined) return undefined;
    while (true) {
      skipWs();
      if (cleaned[idx] === '*') {
        idx++;
        const right = parseFactor();
        if (right === undefined) return undefined;
        left *= right;
      } else {
        break;
      }
    }
    return left;
  };
  const parseFactor = (): number | undefined => {
    skipWs();
    if (cleaned[idx] === '(') {
      idx++;
      const val = parseExpr();
      skipWs();
      if (val === undefined || cleaned[idx] !== ')') return undefined;
      idx++;
      return val;
    }
    if (cleaned[idx] === '-' || cleaned[idx] === '+') {
      const sign = cleaned[idx] === '-' ? -1 : 1;
      idx++;
      const val = parseFactor();
      return val === undefined ? undefined : sign * val;
    }
    const start = idx;
    while (idx < cleaned.length && /[0-9]/.test(cleaned[idx])) idx++;
    if (idx === start) return undefined;
    return parseInt(cleaned.slice(start, idx), 10);
  };

  const result = parseExpr();
  skipWs();
  if (result === undefined || idx !== cleaned.length || !Number.isFinite(result)) {
    return undefined;
  }
  return result;
}

/**
 * Resolves chained alias references inside an alias expression (e.g. s[base:base+3] -> s[4:7]).
 */
export function resolveAliasExpression(
  parsed: ParsedDocument,
  sym: AssemblySymbol,
  maxDepth = 8
): string | undefined {
  if (sym.kind !== 'alias' || !sym.expression) {
    return undefined;
  }

  let current = sym.expression;
  for (let depth = 0; depth < maxDepth; depth++) {
    let changed = false;
    current = current.replace(/[A-Za-z_.$][A-Za-z0-9_.$]*/g, (ident) => {
      if (ident === sym.name) return ident;
      const defs = findDefinitions(parsed, ident, sym.line);
      const aliasDef = defs.find((d) => d.kind === 'alias' && d.expression);
      if (aliasDef && aliasDef.expression) {
        changed = true;
        return aliasDef.expression;
      }
      return ident;
    });
    if (!changed) break;
  }

  // Simplify arithmetic inside register brackets, e.g. s[4:4+3] -> s[4:7], v[8+2] -> v[10]
  current = current.replace(
    /\b([sva]|ttmp)\s*\[\s*([^:\]]+?)(?:\s*:\s*([^\]]+?))?\s*\]/gi,
    (full, prefix: string, loExpr: string, hiExpr?: string) => {
      const loVal = tryEvalSimpleIntExpr(loExpr);
      if (hiExpr !== undefined) {
        const hiVal = tryEvalSimpleIntExpr(hiExpr);
        const loStr = loVal !== undefined ? String(loVal) : loExpr.trim();
        const hiStr = hiVal !== undefined ? String(hiVal) : hiExpr.trim();
        return `${prefix.toLowerCase()}[${loStr}:${hiStr}]`;
      }
      if (loVal !== undefined) {
        return `${prefix.toLowerCase()}${loVal}`;
      }
      return full;
    }
  );

  // Also simplify standalone integer expression
  const simpleVal = tryEvalSimpleIntExpr(current);
  if (simpleVal !== undefined) {
    return String(simpleVal);
  }

  return current;
}

/**
 * Formats a Markdown hover card for an alias symbol.
 */
export function formatAliasHoverMarkdown(
  parsed: ParsedDocument,
  sym: AssemblySymbol
): string {
  const regLabelMap: Record<RegisterClass, string> = {
    sgpr: 'SGPR Alias',
    vgpr: 'VGPR Alias',
    agpr: 'AGPR Alias',
    special: 'Special Register Alias',
    expr: 'Symbol Alias',
  };

  const resolved = resolveAliasExpression(parsed, sym);
  const effectiveClass = resolved
    ? classifyRegisterExpression(resolved)
    : sym.registerClass || 'expr';
  const label = regLabelMap[effectiveClass];

  const lines: string[] = [];
  lines.push(`### \`${sym.name}\` *(${label})*`);
  lines.push(`**Defined via:** \`${sym.directive || '='}\` (line ${sym.line + 1})`);

  if (sym.expression) {
    lines.push('\n```gcn-asm');
    if (sym.directive === '#define') {
      lines.push(`#define ${sym.name} ${sym.expression}`);
    } else if (sym.directive === '=') {
      lines.push(`${sym.name} = ${sym.expression}`);
    } else {
      lines.push(`${sym.directive || '.set'} ${sym.name}, ${sym.expression}`);
    }
    lines.push('```');
  }

  if (resolved && resolved !== sym.expression) {
    lines.push(`**Resolved:** \`${resolved}\``);
  }

  return lines.join('\n');
}
