import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { InstructionDb } from '../src/instructionDb';

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'instructions.json');
const db = InstructionDb.loadFromFile(DB_PATH);

describe('InstructionDb', () => {
  it('loads all 10 AMD GPU architectures and >2000 instructions', () => {
    assert.deepEqual(db.meta.archs, [
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
    ]);
    assert.ok(db.meta.instructionCount > 2000, `Expected >2000 instructions, got ${db.meta.instructionCount}`);
    assert.equal(db.meta.sourceFiles.length, 10);
  });

  it('performs case-insensitive lookup', () => {
    const lower = db.lookup('v_add_f32');
    const upper = db.lookup('V_ADD_F32');
    const mixed = db.lookup('V_Add_F32');

    assert.ok(lower);
    assert.ok(upper);
    assert.ok(mixed);
    assert.equal(lower.canonicalName, 'v_add_f32');
    assert.equal(upper.canonicalName, 'v_add_f32');
    assert.equal(mixed.canonicalName, 'v_add_f32');
    assert.equal(lower.record.a.length, 10);
  });

  it('handles _e32, _e64, _dpp, and _sdwa variant suffixes', () => {
    for (const suffix of ['_e32', '_e64', '_dpp', '_sdwa', '_E64']) {
      const res = db.lookup(`v_add_f32${suffix}`);
      assert.ok(res, `Expected lookup match for v_add_f32${suffix}`);
      assert.equal(res.canonicalName, 'v_add_f32');
      assert.equal(res.variantSuffix, suffix.toLowerCase());
    }
  });

  it('resolves legacy and modern instruction aliases cleanly', () => {
    const b32 = db.lookup('s_load_b32');
    const dword = db.lookup('s_load_dword');
    assert.ok(b32);
    assert.ok(dword);
    assert.ok(b32.record.a.includes('RDNA4'));
    assert.ok(dword.record.a.includes('CDNA1'));
    assert.ok(dword.record.a.includes('RDNA4'));

    const dsLoad = db.lookup('ds_load_b32');
    const dsRead = db.lookup('ds_read_b32');
    assert.ok(dsLoad);
    assert.ok(dsRead);
  });

  it('preserves architecture-specific instructions (CDNA MFMA vs RDNA WMMA)', () => {
    const mfma = db.lookup('v_mfma_f32_16x16x16_f16');
    assert.ok(mfma, 'Expected CDNA MFMA instruction');
    assert.ok(mfma.record.a.some((a) => a.startsWith('CDNA')));
    assert.ok(!mfma.record.a.some((a) => a.startsWith('RDNA')));

    const wmma = db.lookup('v_swmmac_bf16_16x16x32_bf16');
    assert.ok(wmma, 'Expected RDNA4 SWMMAC instruction');
    assert.ok(wmma.record.a.includes('RDNA4'));
  });

  it('returns undefined for unknown tokens or empty strings', () => {
    assert.equal(db.lookup(''), undefined);
    assert.equal(db.lookup('   '), undefined);
    assert.equal(db.lookup('not_a_real_gcn_inst'), undefined);
    assert.equal(db.lookup('s0'), undefined);
  });

  it('formats a rich Markdown hover card with archs, description, syntax, and operands', () => {
    const res = db.lookup('v_add_f32_e64');
    assert.ok(res);
    const md = db.formatHoverMarkdown(res);

    assert.match(md, /### `v_add_f32_e64`/);
    assert.match(md, /E64 variant of `v_add_f32`/);
    assert.match(md, /\*\*Group:\*\* VALU/);
    assert.match(md, /\*\*Architectures:\*\*.*`CDNA1`.*`RDNA4`/);
    assert.match(md, /```gcn-asm/);
    assert.match(md, /\*\*Operands\*\*/);
    assert.match(md, /\| `vdst` \|/);
  });

  it('formats alias and alias + variant suffix hover headers and syntax accurately', () => {
    const aliasRes = db.lookup('v_accvgpr_read_b32');
    assert.ok(aliasRes);
    assert.equal(aliasRes.isAlias, true);
    assert.equal(aliasRes.canonicalName, 'v_accvgpr_read');

    const aliasMd = db.formatHoverMarkdown(aliasRes);
    assert.match(aliasMd, /### `v_accvgpr_read_b32` \*\(alias of `v_accvgpr_read`\)\*/);
    assert.match(aliasMd, /```gcn-asm\nv_accvgpr_read_b32 /);

    const aliasVarRes = db.lookup('V_ACCVGPR_READ_B32_E64');
    assert.ok(aliasVarRes);
    assert.equal(aliasVarRes.isAlias, true);
    assert.equal(aliasVarRes.variantSuffix, '_e64');
    assert.equal(aliasVarRes.canonicalName, 'v_accvgpr_read');

    const aliasVarMd = db.formatHoverMarkdown(aliasVarRes);
    assert.match(
      aliasVarMd,
      /### `v_accvgpr_read_b32_e64` \*\(E64 variant; alias of `v_accvgpr_read`\)\*/
    );
    assert.match(aliasVarMd, /```gcn-asm\nv_accvgpr_read_b32_e64 /);
  });
});
