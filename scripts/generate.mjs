#!/usr/bin/env node
/**
 * Generates:
 *   1. data/instructions.json            - Compact merged AMD GCN/CDNA/RDNA ISA database
 *   2. syntaxes/gcn-asm.tmLanguage.json  - TextMate grammar driven by XML ISA specs
 *
 * Usage:
 *   node scripts/generate.mjs [--xml-dir <path>]
 *   AMD_GPU_ISA_DIR=<path> node scripts/generate.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DEFAULT_XML_DIR = 'F:\\Downloads\\AMD_GPU_ISA';

const ARCH_ORDER = [
  'CDNA1',
  'CDNA2',
  'CDNA3',
  'CDNA4',
  'CDNA5',
  'RDNA1',
  'RDNA2',
  'RDNA3',
  'RDNA3.5',
  'RDNA4',
];

function parseCliXmlDir() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--xml-dir' || args[i] === '-d') && args[i + 1]) {
      return args[i + 1];
    }
    if (args[i].startsWith('--xml-dir=')) {
      return args[i].slice('--xml-dir='.length);
    }
    if (!args[i].startsWith('-')) {
      return args[i];
    }
  }
  return process.env.AMD_GPU_ISA_DIR || DEFAULT_XML_DIR;
}

function normalizeArchName(rawName, filename) {
  if (rawName) {
    const cleaned = String(rawName)
      .replace(/^AMD\s+/i, '')
      .replace(/\s+/g, '')
      .toUpperCase();
    if (ARCH_ORDER.includes(cleaned)) {
      return cleaned;
    }
  }
  // Fallback to filename parsing
  const m = filename.match(/(cdna|rdna)(\d+)(?:_(\d+))?/i);
  if (m) {
    return `${m[1].toUpperCase()}${m[2]}${m[3] ? '.' + m[3] : ''}`;
  }
  return rawName || filename;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanDescription(raw) {
  if (!raw) return '';
  let text = decodeHtmlEntities(raw);
  // Convert basic HTML markup to clean Markdown/plain text
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<\/?b>/gi, '**')
    .replace(/<\/?strong>/gi, '**')
    .replace(/<\/?i>/gi, '*')
    .replace(/<\/?em>/gi, '*')
    .replace(/<\/?code>/gi, '`')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/?(ul|ol|div|span|table|tr|td|th|thead|tbody|sup|sub)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  // Normalize whitespace
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function simplifyEncodingName(raw) {
  if (!raw) return '';
  return String(raw).replace(/^ENC_/, '');
}

function simplifyOperandType(raw) {
  if (!raw) return '';
  return String(raw).replace(/^OPR_/, '').toLowerCase();
}

function simplifyDataFormat(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/^FMT_NUM_/, '')
    .replace(/^FMT_/, '')
    .toLowerCase();
}

function isPrimaryEncodingVariant(encName) {
  // Filter out pure microcode sub-variants like VOP2_INST_LITERAL, VOP2_DPP, VOP2_SDWA
  // that repeat the same logical operands as the base encoding.
  return !/_(INST_LITERAL|LITERAL|DPP\d*|SDWA\d*)$/i.test(encName);
}

function extractEncodings(inst) {
  const rawList = inst.InstructionEncodings?.InstructionEncoding || [];
  const results = [];
  const seenKey = new Set();

  for (const enc of rawList) {
    const encName = simplifyEncodingName(enc.EncodingName);
    if (!encName || !isPrimaryEncodingVariant(encName)) {
      continue;
    }

    const rawOperands = enc.Operands?.Operand || [];
    const sorted = [...rawOperands].sort(
      (a, b) => Number(a['@_Order'] || 0) - Number(b['@_Order'] || 0)
    );

    const explicitOps = [];
    for (const op of sorted) {
      if (String(op['@_IsImplicit']).toLowerCase() === 'true') {
        continue;
      }
      const field = op.FieldName ? String(op.FieldName).toLowerCase() : simplifyOperandType(op.OperandType);
      const isIn = String(op['@_Input']).toLowerCase() === 'true';
      const isOut = String(op['@_Output']).toLowerCase() === 'true';
      const dir = isIn && isOut ? 'inout' : isOut ? 'out' : 'in';
      const type = simplifyOperandType(op.OperandType);
      const fmt = simplifyDataFormat(op.DataFormatName);
      const size = op.OperandSize ? Number(op.OperandSize) : undefined;

      explicitOps.push({
        name: field,
        type,
        fmt,
        size,
        dir,
      });
    }

    const opSig = explicitOps.map((o) => `${o.name}:${o.type}:${o.size || ''}:${o.dir}`).join(',');
    const dedupKey = `${encName}|${opSig}`;
    if (seenKey.has(dedupKey)) {
      continue;
    }
    seenKey.add(dedupKey);

    results.push({
      enc: encName,
      operands: explicitOps,
    });
  }

  // If all encodings were filtered out (rare), keep the first one
  if (results.length === 0 && rawList.length > 0) {
    const enc = rawList[0];
    const encName = simplifyEncodingName(enc.EncodingName);
    const rawOperands = enc.Operands?.Operand || [];
    const sorted = [...rawOperands].sort(
      (a, b) => Number(a['@_Order'] || 0) - Number(b['@_Order'] || 0)
    );
    const explicitOps = sorted
      .filter((op) => String(op['@_IsImplicit']).toLowerCase() !== 'true')
      .map((op) => {
        const isIn = String(op['@_Input']).toLowerCase() === 'true';
        const isOut = String(op['@_Output']).toLowerCase() === 'true';
        return {
          name: op.FieldName ? String(op.FieldName).toLowerCase() : simplifyOperandType(op.OperandType),
          type: simplifyOperandType(op.OperandType),
          fmt: simplifyDataFormat(op.DataFormatName),
          size: op.OperandSize ? Number(op.OperandSize) : undefined,
          dir: isIn && isOut ? 'inout' : isOut ? 'out' : 'in',
        };
      });
    results.push({ enc: encName, operands: explicitOps });
  }

  return results;
}

function parseXmlFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const archMatch = xml.match(/<ArchitectureName>(.*?)<\/ArchitectureName>/);
  const arch = normalizeArchName(archMatch ? archMatch[1] : '', path.basename(filePath));

  const startIdx = xml.indexOf('<Instructions>');
  const endIdx = xml.indexOf('</Instructions>');
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`No <Instructions> section found in ${filePath}`);
  }
  const slice = xml.slice(startIdx, endIdx + '</Instructions>'.length);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    parseTagValue: false,
    isArray: (name) =>
      ['Instruction', 'InstructionEncoding', 'Operand', 'Subgroup', 'InstructionName'].includes(name),
  });

  const parsed = parser.parse(slice);
  const instructions = parsed.Instructions?.Instruction || [];
  return { arch, instructions };
}

function buildInstructionDatabase(xmlDir) {
  if (!fs.existsSync(xmlDir)) {
    throw new Error(`XML directory not found: ${xmlDir}`);
  }

  const xmlFiles = fs
    .readdirSync(xmlDir)
    .filter((f) => f.toLowerCase().endsWith('.xml'))
    .sort();

  if (xmlFiles.length === 0) {
    throw new Error(`No .xml files found in ${xmlDir}`);
  }

  const instMap = new Map();
  // Map of alias -> Set of { canonical, arch }
  const aliasLinks = new Map();
  const seenArchs = new Set();

  for (const file of xmlFiles) {
    const fullPath = path.join(xmlDir, file);
    const { arch, instructions } = parseXmlFile(fullPath);
    seenArchs.add(arch);

    for (const inst of instructions) {
      const rawName = Array.isArray(inst.InstructionName)
        ? inst.InstructionName[0]
        : inst.InstructionName;
      if (!rawName) continue;

      const name = String(rawName).trim().toLowerCase();
      const desc = cleanDescription(inst.Description);
      const group = inst.FunctionalGroup?.Name ? String(inst.FunctionalGroup.Name).trim() : '';
      const rawSubgroups = inst.FunctionalGroup?.FunctionalSubgroups?.Subgroup || [];
      const subgroups = rawSubgroups
        .map((s) => String(s).trim())
        .filter((s) => s && s !== 'NOT_ASSIGNED');

      const flags = [];
      if (inst.InstructionFlags) {
        if (String(inst.InstructionFlags.IsBranch).toUpperCase() === 'TRUE') flags.push('branch');
        if (String(inst.InstructionFlags.IsConditionalBranch).toUpperCase() === 'TRUE') flags.push('conditional');
        if (String(inst.InstructionFlags.IsIndirectBranch).toUpperCase() === 'TRUE') flags.push('indirect');
        if (String(inst.InstructionFlags.IsProgramTerminator).toUpperCase() === 'TRUE') flags.push('terminator');
      }

      const encodings = extractEncodings(inst);

      const rawAliases = inst.AliasedInstructionNames?.InstructionName || [];
      const instAliases = rawAliases
        .map((a) => String(a).trim().toLowerCase())
        .filter((a) => a && a !== name);

      let entry = instMap.get(name);
      if (!entry) {
        entry = {
          name,
          desc,
          group,
          subgroups: new Set(subgroups),
          flags: new Set(flags),
          archs: new Set([arch]),
          aliases: new Set(instAliases),
          encodingsMap: new Map(),
        };
        instMap.set(name, entry);
      } else {
        entry.archs.add(arch);
        // Prefer longer/non-empty description (newer specs often have fuller descriptions)
        if (desc && (!entry.desc || desc.length > entry.desc.length)) {
          entry.desc = desc;
        }
        if (group && !entry.group) {
          entry.group = group;
        }
        for (const sg of subgroups) entry.subgroups.add(sg);
        for (const fl of flags) entry.flags.add(fl);
        for (const al of instAliases) entry.aliases.add(al);
      }

      for (const encObj of encodings) {
        const opKey = encObj.operands.map((o) => `${o.name}:${o.type}:${o.size || ''}`).join(',');
        const key = `${encObj.enc}|${opKey}`;
        if (!entry.encodingsMap.has(key)) {
          entry.encodingsMap.set(key, encObj);
        }
      }

      for (const al of instAliases) {
        if (!aliasLinks.has(al)) aliasLinks.set(al, []);
        aliasLinks.get(al).push({ canonical: name, arch });
      }
    }
  }

  // Finalize instructions & alias map
  const instructionsOut = {};
  const aliasesOut = {};

  const sortArchs = (archSet) =>
    [...archSet].sort((a, b) => {
      const ia = ARCH_ORDER.indexOf(a);
      const ib = ARCH_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return a.localeCompare(b);
    });

  // For aliases that also exist as primary instructions in older archs,
  // record their additional alias archs and link canonical name.
  for (const [aliasName, links] of aliasLinks.entries()) {
    const primary = instMap.get(aliasName);
    if (primary) {
      for (const { canonical, arch } of links) {
        primary.archs.add(arch);
        primary.aliases.add(canonical);
      }
    } else {
      // Pick the canonical target with the most archs
      const counts = new Map();
      for (const { canonical } of links) {
        counts.set(canonical, (counts.get(canonical) || 0) + 1);
      }
      let bestCanonical = links[0].canonical;
      let bestCount = 0;
      for (const [c, cnt] of counts.entries()) {
        if (cnt > bestCount) {
          bestCount = cnt;
          bestCanonical = c;
        }
      }
      aliasesOut[aliasName] = bestCanonical;
    }
  }

  const sortedNames = [...instMap.keys()].sort();
  for (const name of sortedNames) {
    const e = instMap.get(name);
    const encs = [...e.encodingsMap.values()];
    const record = {
      d: e.desc,
      g: e.group,
      a: sortArchs(e.archs),
      e: encs.map((enc) => ({
        n: enc.enc,
        o: enc.operands.map((op) => {
          const compact = { n: op.name, t: op.type, d: op.dir };
          if (op.fmt) compact.f = op.fmt;
          if (op.size) compact.s = op.size;
          return compact;
        }),
      })),
    };
    if (e.subgroups.size > 0) record.sg = [...e.subgroups].sort();
    if (e.flags.size > 0) record.fl = [...e.flags].sort();
    if (e.aliases.size > 0) record.al = [...e.aliases].sort();
    instructionsOut[name] = record;
  }

  return {
    meta: {
      archs: sortArchs(seenArchs),
      instructionCount: sortedNames.length,
      aliasCount: Object.keys(aliasesOut).length,
      sourceFiles: xmlFiles,
    },
    instructions: instructionsOut,
    aliases: aliasesOut,
  };
}

/**
 * Builds a compact trie-based regex from a list of lowercase strings.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTrieRegex(words) {
  if (words.length === 0) return '(?!)';
  const root = Object.create(null);
  for (const w of words) {
    let node = root;
    for (const ch of w) {
      if (!node[ch]) node[ch] = Object.create(null);
      node = node[ch];
    }
    node['$'] = true;
  }

  function serialize(node) {
    const keys = Object.keys(node).filter((k) => k !== '$').sort();
    const hasEnd = Boolean(node['$']);

    if (keys.length === 0) {
      return '';
    }

    // Collapse linear chains
    if (keys.length === 1 && !hasEnd) {
      let prefix = '';
      let curr = node;
      while (true) {
        const ks = Object.keys(curr).filter((k) => k !== '$');
        if (ks.length === 1 && !curr['$']) {
          prefix += escapeRegex(ks[0]);
          curr = curr[ks[0]];
        } else {
          break;
        }
      }
      return prefix + serialize(curr);
    }

    const branches = keys.map((k) => escapeRegex(k) + serialize(node[k]));
    // Sort longer branches first so greedy matching prefers full mnemonics
    branches.sort((a, b) => b.length - a.length || a.localeCompare(b));

    const body = branches.length === 1 ? branches[0] : `(?:${branches.join('|')})`;
    return hasEnd ? `(?:${body})?` : body;
  }

  return serialize(root);
}

function buildTextMateGrammar(db) {
  const allMnemonics = new Set([
    ...Object.keys(db.instructions),
    ...Object.keys(db.aliases),
  ]);

  // Partition mnemonics by functional category for richer syntax highlighting
  const branchInsts = [];
  const memoryInsts = [];
  const matrixInsts = [];
  const scalarInsts = [];
  const vectorInsts = [];
  const otherInsts = [];

  for (const name of allMnemonics) {
    const canonical = db.aliases[name] || name;
    const rec = db.instructions[canonical];
    const group = rec?.g || '';
    const flags = rec?.fl || [];

    if (flags.includes('branch') || flags.includes('terminator') || group === 'BRANCH' || group === 'WAVE_CONTROL' || group === 'TRAP') {
      branchInsts.push(name);
    } else if (
      name.includes('mfma') ||
      name.includes('wmma') ||
      name.includes('smfmac') ||
      name.includes('swmmac')
    ) {
      matrixInsts.push(name);
    } else if (
      group === 'SMEM' ||
      group === 'VMEM' ||
      group === 'EXPORT' ||
      /^(ds_|flat_|global_|scratch_|buffer_|tbuffer_|image_|s_load|s_store|s_buffer_|s_atomic_|s_dcache|s_gl1|s_atc|exp$)/.test(name)
    ) {
      memoryInsts.push(name);
    } else if (group === 'SALU' || name.startsWith('s_')) {
      scalarInsts.push(name);
    } else if (group === 'VALU' || name.startsWith('v_')) {
      vectorInsts.push(name);
    } else {
      otherInsts.push(name);
    }
  }

  const mkInstPattern = (list, scopeName) => ({
    name: scopeName,
    match: `(?i)(?<![A-Za-z0-9_.$])(?:${buildTrieRegex(list)})(?:_(?:e32|e64|dpp|sdwa))?(?![A-Za-z0-9_.$])`,
  });

  const instructionPatterns = [];
  if (branchInsts.length > 0) instructionPatterns.push(mkInstPattern(branchInsts, 'keyword.control.instruction.gcn-asm'));
  if (matrixInsts.length > 0) instructionPatterns.push(mkInstPattern(matrixInsts, 'support.function.matrix.instruction.gcn-asm'));
  if (memoryInsts.length > 0) instructionPatterns.push(mkInstPattern(memoryInsts, 'entity.name.function.memory.instruction.gcn-asm'));
  if (scalarInsts.length > 0) instructionPatterns.push(mkInstPattern(scalarInsts, 'keyword.operator.scalar.instruction.gcn-asm'));
  if (vectorInsts.length > 0) instructionPatterns.push(mkInstPattern(vectorInsts, 'support.function.vector.instruction.gcn-asm'));
  if (otherInsts.length > 0) instructionPatterns.push(mkInstPattern(otherInsts, 'keyword.mnemonic.instruction.gcn-asm'));

  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'AMD GCN/CDNA/RDNA Assembly',
    scopeName: 'source.gcn-asm',
    fileTypes: ['s', 'S', 'gcn'],
    patterns: [
      { include: '#comments' },
      { include: '#strings' },
      { include: '#preprocessor' },
      { include: '#labels' },
      { include: '#directives' },
      { include: '#instructions' },
      { include: '#modifiers' },
      { include: '#registers' },
      { include: '#numbers' },
      { include: '#operators' },
    ],
    repository: {
      comments: {
        patterns: [
          {
            name: 'comment.block.gcn-asm',
            begin: '/\\*',
            end: '\\*/',
          },
          {
            name: 'comment.line.double-slash.gcn-asm',
            match: '//.*$',
          },
          {
            name: 'comment.line.semicolon.gcn-asm',
            match: ';.*$',
          },
        ],
      },
      strings: {
        patterns: [
          {
            name: 'string.quoted.double.gcn-asm',
            begin: '"',
            end: '"',
            patterns: [
              {
                name: 'constant.character.escape.gcn-asm',
                match: '\\\\.',
              },
            ],
          },
          {
            name: 'string.quoted.single.gcn-asm',
            begin: "'",
            end: "'",
            patterns: [
              {
                name: 'constant.character.escape.gcn-asm',
                match: '\\\\.',
              },
            ],
          },
        ],
      },
      preprocessor: {
        patterns: [
          {
            name: 'meta.preprocessor.gcn-asm',
            match: '^\\s*(#\\s*(?:define|undef|include|if|ifdef|ifndef|elif|else|endif|pragma|error|warning))\\b',
            captures: {
              1: { name: 'keyword.control.directive.preprocessor.gcn-asm' },
            },
          },
        ],
      },
      labels: {
        patterns: [
          {
            name: 'entity.name.label.gcn-asm',
            match: '^\\s*([A-Za-z_.$][A-Za-z0-9_.$]*|\\d+)(:)',
            captures: {
              1: { name: 'entity.name.label.gcn-asm' },
              2: { name: 'punctuation.separator.label.gcn-asm' },
            },
          },
        ],
      },
      directives: {
        patterns: [
          {
            name: 'keyword.control.directive.gcn-asm',
            match: '(?<![A-Za-z0-9_.$])\\.(?:text|data|rodata|bss|section|globl|global|local|weak|hidden|protected|internal|set|equ|equiv|eqv|amdhsa_kernel|end_amdhsa_kernel|amdhsa_[A-Za-z0-9_]+|amdgcn_target|amdgpu_metadata|end_amdgpu_metadata|amdgpu_hsa_kernel|amdgpu_hsa_metadata|end_amdgpu_hsa_metadata|hsa_code_object_version|hsa_code_object_isa|macro|endm|exitm|purgem|if|ifdef|ifndef|ifb|ifnb|ifeq|ifne|ifgt|ifge|iflt|ifle|elseif|else|endif|rept|irp|irpc|endr|p2align|balign|align|type|size|byte|2byte|4byte|8byte|short|hword|word|int|long|quad|float|double|ascii|asciz|string|space|skip|zero|fill|include|incbin|altmacro|noaltmacro|ident|file|loc|cfi_[A-Za-z0-9_]+|error|warning|print)(?![A-Za-z0-9_.$])',
          },
        ],
      },
      instructions: {
        patterns: instructionPatterns,
      },
      modifiers: {
        patterns: [
          {
            name: 'support.type.waitcnt.gcn-asm',
            match: '(?i)\\b(?:vmcnt|lgkmcnt|expcnt|vscnt|loadcnt|storecnt|samplecnt|bvhcnt|dscnt|kmcnt)\\s*\\([^)]*\\)',
          },
          {
            name: 'entity.other.attribute-name.modifier.gcn-asm',
            match: '(?i)\\b(?:offset0?|offset1|omod|dmask|dim|row_mask|bank_mask|bound_ctrl|fi|quad_perm|row_shr|row_shl|row_ror|row_bcast|dst_sel|dst_unused|src0_sel|src1_sel|op_sel|op_sel_hi|neg_lo|neg_hi|cbsz|abid|blgp|th|scope|format|dfmt|nfmt|hwreg|sendmsg)\\s*:',
          },
          {
            name: 'storage.modifier.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])(?:glc|slc|dlc|sc0|sc1|nt|clamp|abs|neg|unorm|da|r128|a16|d16|lwe|tfe|idxen|offen|lds|gds|high|shared|mul:2|mul:4|div:2)(?![A-Za-z0-9_.$])',
          },
        ],
      },
      registers: {
        patterns: [
          {
            name: 'variable.other.register.vector.range.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])[va]\\s*\\[[^\\]]+\\]',
          },
          {
            name: 'variable.other.register.scalar.range.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])(?:s|ttmp)\\s*\\[[^\\]]+\\]',
          },
          {
            name: 'variable.other.register.vector.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])v(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?![A-Za-z0-9_.$])',
          },
          {
            name: 'variable.other.register.acc.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])a(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?![A-Za-z0-9_.$])',
          },
          {
            name: 'variable.other.register.scalar.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])s(?:10[0-5]|[1-9]\\d|\\d)(?![A-Za-z0-9_.$])',
          },
          {
            name: 'variable.other.register.ttmp.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])ttmp(?:1[0-5]|\\d)(?![A-Za-z0-9_.$])',
          },
          {
            name: 'variable.language.register.special.gcn-asm',
            match: '(?i)(?<![A-Za-z0-9_.$])(?:vcc|vcc_lo|vcc_hi|exec|exec_lo|exec_hi|scc|m0|null|off|flat_scratch|flat_scratch_lo|flat_scratch_hi|xnack_mask|xnack_mask_lo|xnack_mask_hi|tba|tba_lo|tba_hi|tma|tma_lo|tma_hi|src_scc|src_execz|src_vccz|src_lds_direct|src_shared_base|src_private_base|src_pops_exiting_wave_id|lds_direct|shared_base|shared_limit|private_base|private_limit)(?![A-Za-z0-9_.$])',
          },
        ],
      },
      numbers: {
        patterns: [
          {
            name: 'constant.numeric.hex.gcn-asm',
            match: '(?<![A-Za-z0-9_.$])-?0[xX][0-9a-fA-F]+(?![A-Za-z0-9_.$])',
          },
          {
            name: 'constant.numeric.binary.gcn-asm',
            match: '(?<![A-Za-z0-9_.$])-?0[bB][01]+(?![A-Za-z0-9_.$])',
          },
          {
            name: 'constant.numeric.float.gcn-asm',
            match: '(?<![A-Za-z0-9_.$])-?\\d+\\.\\d+(?:[eE][+-]?\\d+)?(?![A-Za-z0-9_.$])',
          },
          {
            name: 'constant.numeric.decimal.gcn-asm',
            match: '(?<![A-Za-z0-9_.$])-?\\d+(?![A-Za-z0-9_.$])',
          },
        ],
      },
      operators: {
        patterns: [
          {
            name: 'keyword.operator.gcn-asm',
            match: '[+\\-*/%&|^~!<>=,]+',
          },
        ],
      },
    },
  };
}

function main() {
  const xmlDir = parseCliXmlDir();
  console.log(`Reading AMD GPU ISA XML specs from: ${xmlDir}`);

  const t0 = Date.now();
  const db = buildInstructionDatabase(xmlDir);
  const grammar = buildTextMateGrammar(db);

  const dataDir = path.join(ROOT_DIR, 'data');
  const syntaxesDir = path.join(ROOT_DIR, 'syntaxes');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(syntaxesDir, { recursive: true });

  const dbPath = path.join(dataDir, 'instructions.json');
  const grammarPath = path.join(syntaxesDir, 'gcn-asm.tmLanguage.json');

  fs.writeFileSync(dbPath, JSON.stringify(db), 'utf8');
  fs.writeFileSync(grammarPath, JSON.stringify(grammar, null, 2) + '\n', 'utf8');

  const dbSizeKb = (fs.statSync(dbPath).size / 1024).toFixed(1);
  const grammarSizeKb = (fs.statSync(grammarPath).size / 1024).toFixed(1);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  console.log(`Generated in ${elapsed}s:`);
  console.log(`  - ${dbPath} (${dbSizeKb} KB): ${db.meta.instructionCount} instructions, ${db.meta.aliasCount} aliases across ${db.meta.archs.join(', ')}`);
  console.log(`  - ${grammarPath} (${grammarSizeKb} KB)`);
}

main();
