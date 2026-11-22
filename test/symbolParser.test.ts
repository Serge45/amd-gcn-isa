import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  findDefinitions,
  formatAliasHoverMarkdown,
  getWordAtPosition,
  maskCommentsAndStrings,
  parseDocument,
  resolveAliasExpression,
} from '../src/symbolParser';

describe('symbolParser', () => {
  it('masks //, ;, /* */ comments and strings while preserving exact character offsets', () => {
    const src = [
      's_mov_b32 s0, 1 // comment .set fake, s1',
      '/* block comment',
      'fake_label:',
      '*/ real_label: ; trailing comment',
      '.asciz "not_a_label: inside string"',
    ].join('\n');

    const masked = maskCommentsAndStrings(src);
    assert.equal(masked.length, 5);
    assert.equal(masked[0].length, src.split('\n')[0].length);
    assert.ok(!masked[0].includes('fake'));
    assert.ok(!masked[2].includes('fake_label'));
    assert.ok(masked[3].includes('real_label:'));
    assert.equal(masked[3].indexOf('real_label'), src.split('\n')[3].indexOf('real_label'));
    assert.ok(!masked[4].includes('not_a_label'));
  });

  it('parses label definitions including dot-prefixed labels and ignores comments', () => {
    const src = [
      '// .L_commented:',
      '.L_loop:',
      '    s_branch .L_done',
      '  target:',
      '    s_cbranch_scc1 .L_loop',
      '.L_done:',
      '    s_endpgm',
    ].join('\n');

    const parsed = parseDocument(src);
    const labels = parsed.symbols.filter((s) => s.kind === 'label');
    assert.deepEqual(
      labels.map((l) => ({ name: l.name, line: l.line, startCol: l.startCol })),
      [
        { name: '.L_loop', line: 1, startCol: 0 },
        { name: 'target', line: 3, startCol: 2 },
        { name: '.L_done', line: 5, startCol: 0 },
      ]
    );

    // Forward reference to .L_done from line 2
    const forward = findDefinitions(parsed, '.L_done', 2);
    assert.equal(forward.length, 1);
    assert.equal(forward[0].line, 5);

    // Backward reference to .L_loop from line 4
    const backward = findDefinitions(parsed, '.L_loop', 4);
    assert.equal(backward.length, 1);
    assert.equal(backward[0].line, 1);
  });

  it('parses .set, .equ, .equiv, =, and #define SGPR/VGPR/AGPR aliases', () => {
    const src = [
      '.set base, 4',
      '.equ s_ptr, s[base:base+3]',
      '.equiv my_vreg, v[8:9]',
      'acc_reg = a[0:3]',
      '#define tmp_sreg s12',
      'v_add_f32 v[my_vreg], s[base:base+3], a[acc_reg]',
    ].join('\n');

    const parsed = parseDocument(src);
    const aliases = parsed.symbols.filter((s) => s.kind === 'alias');
    assert.equal(aliases.length, 5);

    assert.equal(aliases[0].name, 'base');
    assert.equal(aliases[0].directive, '.set');
    assert.equal(aliases[0].expression, '4');

    assert.equal(aliases[1].name, 's_ptr');
    assert.equal(aliases[1].directive, '.equ');
    assert.equal(aliases[1].registerClass, 'sgpr');

    assert.equal(aliases[2].name, 'my_vreg');
    assert.equal(aliases[2].directive, '.equiv');
    assert.equal(aliases[2].registerClass, 'vgpr');

    assert.equal(aliases[3].name, 'acc_reg');
    assert.equal(aliases[3].directive, '=');
    assert.equal(aliases[3].registerClass, 'agpr');

    assert.equal(aliases[4].name, 'tmp_sreg');
    assert.equal(aliases[4].directive, '#define');
    assert.equal(aliases[4].registerClass, 'sgpr');
  });

  it('extracts alias identifiers inside register range expressions and dot-prefixed labels', () => {
    const src = [
      's_load_b128 s[base:base+3], s[0:1], 0x0',
      'v_mov_b32 v[my_vreg], a[acc_reg]',
      's_branch .L_loop // .L_ignored',
    ].join('\n');

    const masked = maskCommentsAndStrings(src);

    // Cursor on first `base` inside s[base:base+3]
    const base1Col = src.split('\n')[0].indexOf('base');
    const w1 = getWordAtPosition(masked, 0, base1Col + 2);
    assert.equal(w1?.word, 'base');

    // Cursor on second `base` in base+3
    const base2Col = src.split('\n')[0].lastIndexOf('base');
    const w2 = getWordAtPosition(masked, 0, base2Col + 1);
    assert.equal(w2?.word, 'base');

    // Cursor on `my_vreg` inside v[my_vreg]
    const vregCol = src.split('\n')[1].indexOf('my_vreg');
    const w3 = getWordAtPosition(masked, 1, vregCol + 3);
    assert.equal(w3?.word, 'my_vreg');

    // Cursor on `acc_reg` inside a[acc_reg]
    const accCol = src.split('\n')[1].indexOf('acc_reg');
    const w4 = getWordAtPosition(masked, 1, accCol + 2);
    assert.equal(w4?.word, 'acc_reg');

    // Cursor on `.L_loop`
    const lblCol = src.split('\n')[2].indexOf('.L_loop');
    const w5 = getWordAtPosition(masked, 2, lblCol + 2);
    assert.equal(w5?.word, '.L_loop');

    // Cursor inside comment returns undefined
    const cmtCol = src.split('\n')[2].indexOf('.L_ignored');
    const w6 = getWordAtPosition(masked, 2, cmtCol + 2);
    assert.equal(w6, undefined);
  });

  it('handles alias redefinitions by preferring nearest preceding definition', () => {
    const src = [
      '.set idx, 0',        // line 0
      's_mov_b32 s[idx], 1', // line 1 -> should jump to line 0
      '.set idx, 4',        // line 2
      's_mov_b32 s[idx], 2', // line 3 -> should jump to line 2
      '.set idx, 8',        // line 4
      's_mov_b32 s[idx], 3', // line 5 -> should jump to line 4
    ].join('\n');

    const parsed = parseDocument(src);
    assert.equal(findDefinitions(parsed, 'idx', 1)[0].line, 0);
    assert.equal(findDefinitions(parsed, 'idx', 3)[0].line, 2);
    assert.equal(findDefinitions(parsed, 'idx', 5)[0].line, 4);
  });

  it('resolves chained alias expressions and formats alias hover Markdown', () => {
    const src = [
      '.set base, 4',
      '.equ s_desc, s[base:base+3]',
      's_load_b128 s_desc, s[0:1], 0',
    ].join('\n');

    const parsed = parseDocument(src);
    const def = findDefinitions(parsed, 's_desc', 2)[0];
    assert.ok(def);

    const resolved = resolveAliasExpression(parsed, def);
    assert.equal(resolved, 's[4:7]');

    const md = formatAliasHoverMarkdown(parsed, def);
    assert.match(md, /### `s_desc` \*\(SGPR Alias\)\*/);
    assert.match(md, /\*\*Defined via:\*\* `\.equ` \(line 2\)/);
    assert.match(md, /\*\*Resolved:\*\* `s\[4:7\]`/);
  });
});
