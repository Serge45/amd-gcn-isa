import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface TmRule {
  name?: string;
  match?: string;
  begin?: string;
  end?: string;
  patterns?: TmRule[];
}

interface TmGrammar {
  scopeName: string;
  fileTypes: string[];
  patterns: Array<{ include: string }>;
  repository: Record<string, { patterns: TmRule[] }>;
}

const GRAMMAR_PATH = path.resolve(__dirname, '..', '..', 'syntaxes', 'gcn-asm.tmLanguage.json');
const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8')) as TmGrammar;

/**
 * Converts Oniguruma inline (?i) prefix into a JS RegExp with 'i' flag for testing.
 */
function toJsRegex(pattern: string): RegExp {
  if (pattern.startsWith('(?i)')) {
    return new RegExp(pattern.slice(4), 'i');
  }
  return new RegExp(pattern);
}

function collectMatches(repoKey: string, input: string): string[] {
  const rules = grammar.repository[repoKey]?.patterns || [];
  const hits: string[] = [];
  for (const rule of rules) {
    if (!rule.match) continue;
    const re = toJsRegex(rule.match);
    if (re.test(input)) {
      hits.push(rule.name || '');
    }
  }
  return hits;
}

describe('TextMate Grammar (syntaxes/gcn-asm.tmLanguage.json)', () => {
  it('has valid structure and all regexes compile cleanly', () => {
    assert.equal(grammar.scopeName, 'source.gcn-asm');
    assert.ok(grammar.fileTypes.includes('s'));
    assert.ok(grammar.fileTypes.includes('S'));
    assert.ok(grammar.fileTypes.includes('gcn'));

    let ruleCount = 0;
    for (const [key, section] of Object.entries(grammar.repository)) {
      for (const rule of section.patterns) {
        if (rule.match) {
          assert.doesNotThrow(() => toJsRegex(rule.match!), `Invalid match regex in ${key}`);
          ruleCount++;
        }
        if (rule.begin) {
          assert.doesNotThrow(() => toJsRegex(rule.begin!), `Invalid begin regex in ${key}`);
        }
        if (rule.end) {
          assert.doesNotThrow(() => toJsRegex(rule.end!), `Invalid end regex in ${key}`);
        }
      }
    }
    assert.ok(ruleCount >= 20, `Expected >=20 compiled regex rules, got ${ruleCount}`);
  });

  it('matches GCN/CDNA/RDNA instructions including _e32/_e64/_dpp/_sdwa suffixes', () => {
    const samples = [
      'v_add_f32',
      'V_ADD_F32_E64',
      'v_mov_b32_e32',
      'v_add_f32_dpp',
      'v_add_f32_sdwa',
      's_load_b32',
      's_load_dword',
      's_branch',
      's_endpgm',
      'ds_read_b32',
      'ds_load_b32',
      'v_mfma_f32_16x16x16_f16',
    ];
    for (const inst of samples) {
      const hits = collectMatches('instructions', `    ${inst} v0, v1, v2`);
      assert.ok(hits.length > 0, `Expected instruction rule to match "${inst}"`);
    }
  });

  it('matches SGPR, VGPR, AGPR, ranges, ttmp, and special registers', () => {
    const regSamples = [
      's0', 's105', 'v0', 'v255', 'a0', 'a255',
      's[0:3]', 's[base:base+3]', 'v[my_vreg]', 'a[0:15]',
      'ttmp0', 'ttmp15', 'ttmp[0:1]',
      'vcc', 'exec', 'scc', 'm0', 'null', 'off', 'flat_scratch',
    ];
    for (const reg of regSamples) {
      const hits = collectMatches('registers', ` ${reg},`);
      assert.ok(hits.length > 0, `Expected register rule to match "${reg}"`);
    }
    // scc should NOT be matched as a modifier
    assert.equal(collectMatches('modifiers', ' scc,').length, 0);
  });

  it('matches labels, directives, comments, numbers, and modifiers', () => {
    assert.ok(collectMatches('labels', '.L_loop:').length > 0);
    assert.ok(collectMatches('labels', '  my_target:').length > 0);

    for (const dir of ['.text', '.globl', '.set', '.equ', '.equiv', '.amdhsa_kernel', '.amdgcn_target', '.macro', '.endm']) {
      assert.ok(collectMatches('directives', `  ${dir} foo`).length > 0, `Expected directive match for ${dir}`);
    }

    assert.ok(collectMatches('comments', '// line comment').length > 0);
    assert.ok(collectMatches('comments', '; semicolon comment').length > 0);

    for (const mod of ['offset:16', 'glc', 'slc', 'dlc', 'sc0', 'sc1', 'nt', 'clamp', 'omod:2', 'vmcnt(0)', 'lgkmcnt(0)', 'expcnt(0)']) {
      assert.ok(collectMatches('modifiers', ` ${mod} `).length > 0, `Expected modifier match for ${mod}`);
    }

    for (const num of ['0x1f', '0b1010', '42', '-16', '3.14']) {
      assert.ok(collectMatches('numbers', ` ${num} `).length > 0, `Expected number match for ${num}`);
    }
  });
});
