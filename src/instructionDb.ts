import * as fs from 'node:fs';

export interface CompactOperand {
  /** Operand field name (e.g. vdst, src0, sdata) */
  n: string;
  /** Operand type (e.g. vgpr, sreg, src, label) */
  t: string;
  /** Direction: in | out | inout */
  d: 'in' | 'out' | 'inout';
  /** Data format (e.g. f32, b32, i16) */
  f?: string;
  /** Size in bits */
  s?: number;
}

export interface CompactEncoding {
  /** Encoding name without ENC_ prefix (e.g. VOP2, VOP3, SMEM, SOPP) */
  n: string;
  /** Explicit operands in assembly order */
  o: CompactOperand[];
}

export interface CompactInstruction {
  /** Description */
  d: string;
  /** Functional group (e.g. VALU, SALU, SMEM, VMEM, BRANCH) */
  g: string;
  /** Supported architectures (e.g. ["CDNA1", ..., "RDNA4"]) */
  a: string[];
  /** Encodings and operand layouts */
  e: CompactEncoding[];
  /** Functional subgroups */
  sg?: string[];
  /** Flags (branch, conditional, indirect, terminator) */
  fl?: string[];
  /** Known aliases */
  al?: string[];
}

export interface InstructionDatabaseFile {
  meta: {
    archs: string[];
    instructionCount: number;
    aliasCount: number;
    sourceFiles: string[];
  };
  instructions: Record<string, CompactInstruction>;
  aliases: Record<string, string>;
}

export interface InstructionLookupResult {
  /** The exact token queried by the user */
  queriedName: string;
  /** Canonical lowercase instruction name in the database */
  canonicalName: string;
  /** Matched suffix if stripped (e.g. "_e32", "_e64", "_dpp", "_sdwa") */
  variantSuffix?: string;
  /** True if resolved via the aliases map */
  isAlias: boolean;
  /** Instruction metadata */
  record: CompactInstruction;
}

const VARIANT_SUFFIX_RE = /(_(?:e32|e64|dpp|sdwa))$/i;

export class InstructionDb {
  private readonly data: InstructionDatabaseFile;

  constructor(data: InstructionDatabaseFile) {
    this.data = data;
  }

  static loadFromFile(filePath: string): InstructionDb {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as InstructionDatabaseFile;
    return new InstructionDb(parsed);
  }

  get meta(): InstructionDatabaseFile['meta'] {
    return this.data.meta;
  }

  has(token: string): boolean {
    return this.lookup(token) !== undefined;
  }

  lookup(rawToken: string): InstructionLookupResult | undefined {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      return undefined;
    }

    const lower = trimmed.toLowerCase();

    // 1. Direct canonical match
    if (Object.prototype.hasOwnProperty.call(this.data.instructions, lower)) {
      return {
        queriedName: trimmed,
        canonicalName: lower,
        isAlias: false,
        record: this.data.instructions[lower],
      };
    }

    // 2. Direct alias match
    if (Object.prototype.hasOwnProperty.call(this.data.aliases, lower)) {
      const canonical = this.data.aliases[lower];
      const rec = this.data.instructions[canonical];
      if (rec) {
        return {
          queriedName: trimmed,
          canonicalName: canonical,
          isAlias: true,
          record: rec,
        };
      }
    }

    // 3. Strip _e32 / _e64 / _dpp / _sdwa variant suffix and retry
    const suffixMatch = lower.match(VARIANT_SUFFIX_RE);
    if (suffixMatch) {
      const suffix = suffixMatch[1];
      const base = lower.slice(0, lower.length - suffix.length);

      if (Object.prototype.hasOwnProperty.call(this.data.instructions, base)) {
        return {
          queriedName: trimmed,
          canonicalName: base,
          variantSuffix: suffix,
          isAlias: false,
          record: this.data.instructions[base],
        };
      }

      if (Object.prototype.hasOwnProperty.call(this.data.aliases, base)) {
        const canonical = this.data.aliases[base];
        const rec = this.data.instructions[canonical];
        if (rec) {
          return {
            queriedName: trimmed,
            canonicalName: canonical,
            variantSuffix: suffix,
            isAlias: true,
            record: rec,
          };
        }
      }
    }

    return undefined;
  }

  formatHoverMarkdown(result: InstructionLookupResult): string {
    const { canonicalName, queriedName, variantSuffix, isAlias, record } = result;
    const lines: string[] = [];

    // Title
    const displayName = queriedName.toLowerCase();
    let header = `### \`${displayName}\``;
    if (isAlias && variantSuffix) {
      const variantLabel = variantSuffix.slice(1).toUpperCase();
      header += ` *(${variantLabel} variant; alias of \`${canonicalName}\`)*`;
    } else if (isAlias) {
      header += ` *(alias of \`${canonicalName}\`)*`;
    } else if (variantSuffix) {
      const variantLabel = variantSuffix.slice(1).toUpperCase();
      header += ` *(${variantLabel} variant of \`${canonicalName}\`)*`;
    }
    lines.push(header);

    // Group, Encodings, Flags
    const metaParts: string[] = [];
    if (record.g) {
      const sub = record.sg && record.sg.length > 0 ? ` (${record.sg.join(', ')})` : '';
      metaParts.push(`**Group:** ${record.g}${sub}`);
    }
    const encNames = [...new Set(record.e.map((enc) => enc.n))];
    if (encNames.length > 0) {
      metaParts.push(`**Encoding:** ${encNames.join(', ')}`);
    }
    if (record.fl && record.fl.length > 0) {
      metaParts.push(`**Flags:** ${record.fl.join(', ')}`);
    }
    if (metaParts.length > 0) {
      lines.push(metaParts.join(' &nbsp;|&nbsp; '));
    }

    // Supported architectures
    if (record.a.length > 0) {
      const archBadges = record.a.map((a) => `\`${a}\``).join(' ');
      lines.push(`\n**Architectures:** ${archBadges}`);
    }

    // Description
    if (record.d) {
      lines.push(`\n${record.d}`);
    }

    // Syntax block
    if (record.e.length > 0) {
      const syntaxLines: string[] = [];
      const seenSyntax = new Set<string>();
      for (const enc of record.e) {
        const opNames = enc.o.map((o) => o.n).join(', ');
        const sig = opNames ? `${displayName} ${opNames}` : displayName;
        const key = `${sig}|${enc.n}`;
        if (!seenSyntax.has(key)) {
          seenSyntax.add(key);
          syntaxLines.push(`${sig}   // ${enc.n}`);
        }
        if (syntaxLines.length >= 4) break;
      }
      if (syntaxLines.length > 0) {
        lines.push('\n**Syntax**');
        lines.push('```gcn-asm');
        lines.push(...syntaxLines);
        lines.push('```');
      }

      // Operands table (from primary encoding, or best encoding matching variant suffix)
      const primaryEnc = pickEncodingForVariant(record.e, variantSuffix);
      if (primaryEnc && primaryEnc.o.length > 0) {
        lines.push('\n**Operands**');
        lines.push('| Operand | Dir | Type | Format | Bits |');
        lines.push('| :--- | :---: | :--- | :--- | ---: |');
        for (const op of primaryEnc.o) {
          const fmt = op.f || '—';
          const bits = op.s !== undefined ? String(op.s) : '—';
          lines.push(`| \`${op.n}\` | ${op.d} | ${op.t} | ${fmt} | ${bits} |`);
        }
      }
    }

    // Aliases
    if (record.al && record.al.length > 0) {
      const aliasList = record.al.map((a) => `\`${a}\``).join(', ');
      lines.push(`\n**Aliases:** ${aliasList}`);
    }

    return lines.join('\n');
  }
}

function pickEncodingForVariant(
  encodings: CompactEncoding[],
  variantSuffix?: string
): CompactEncoding | undefined {
  if (encodings.length === 0) return undefined;
  if (variantSuffix) {
    const lower = variantSuffix.toLowerCase();
    if (lower === '_e64') {
      const vop3 = encodings.find((e) => e.n.toUpperCase().startsWith('VOP3'));
      if (vop3) return vop3;
    } else if (lower === '_e32') {
      const vop32 = encodings.find((e) => /^VOP[12C]$/i.test(e.n));
      if (vop32) return vop32;
    }
  }
  return encodings[0];
}
