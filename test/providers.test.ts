import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import Module = require('node:module');

// Lightweight mock of the `vscode` API so GcnHoverProvider and GcnDefinitionProvider
// can be tested directly under Node without launching an Electron host.
class MockPosition {
  constructor(public readonly line: number, public readonly character: number) {}
}
class MockRange {
  constructor(public readonly start: MockPosition, public readonly end: MockPosition) {}
}
class MockLocation {
  constructor(public readonly uri: unknown, public readonly range: MockRange) {}
}
class MockMarkdownString {
  public isTrusted = false;
  constructor(public readonly value: string) {}
}
class MockHover {
  constructor(public readonly contents: MockMarkdownString, public readonly range?: MockRange) {}
}

const mockVscode = {
  Position: MockPosition,
  Range: MockRange,
  Location: MockLocation,
  MarkdownString: MockMarkdownString,
  Hover: MockHover,
};

const origLoad = (Module as unknown as { _load: Function })._load;
(Module as unknown as { _load: Function })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean
) {
  if (request === 'vscode') {
    return mockVscode;
  }
  return origLoad.call(this, request, parent, isMain);
};

import { InstructionDb } from '../src/instructionDb';
import { GcnHoverProvider } from '../src/hoverProvider';
import { GcnDefinitionProvider } from '../src/definitionProvider';

const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'instructions.json');
const db = InstructionDb.loadFromFile(DB_PATH);

function makeMockDocument(text: string) {
  return {
    uri: { toString: () => 'file:///test.s' },
    getText: () => text,
  } as unknown as import('vscode').TextDocument;
}

describe('GcnHoverProvider & GcnDefinitionProvider', () => {
  const sampleText = [
    '.set base, 4',
    '.equ my_sreg, s[base:base+3]',
    'v_reg = v[10:11]',
    '#define acc_reg a[0:3]',
    '.L_loop:',
    '    V_ADD_F32_E64 v0, v_reg, v2',
    '    s_load_b128 my_sreg, s[base:base+1], 0x0',
    '    v_mfma_f32_16x16x16_f16 acc_reg, v[0:1], v[2:3], acc_reg',
    '    s_branch .L_loop',
  ].join('\n');

  const doc = makeMockDocument(sampleText);

  it('provides instruction hover for uppercase _e64 variant', () => {
    const provider = new GcnHoverProvider(db);
    const hover = provider.provideHover(doc, new MockPosition(5, 6) as never) as unknown as MockHover;
    assert.ok(hover);
    assert.match(hover.contents.value, /`v_add_f32_e64`/);
    assert.match(hover.contents.value, /CDNA1/);
    assert.match(hover.contents.value, /RDNA4/);
  });

  it('provides alias hover with resolved register expression', () => {
    const provider = new GcnHoverProvider(db);
    const col = sampleText.split('\n')[6].indexOf('my_sreg');
    const hover = provider.provideHover(doc, new MockPosition(6, col + 2) as never) as unknown as MockHover;
    assert.ok(hover);
    assert.match(hover.contents.value, /`my_sreg`/);
    assert.match(hover.contents.value, /SGPR Alias/);
    assert.match(hover.contents.value, /s\[4:7\]/);
  });

  it('jumps to label definition from branch instruction', () => {
    const provider = new GcnDefinitionProvider();
    const col = sampleText.split('\n')[8].indexOf('.L_loop');
    const locs = provider.provideDefinition(doc, new MockPosition(8, col + 3) as never) as unknown as MockLocation[];
    assert.ok(locs && locs.length === 1);
    assert.equal(locs[0].range.start.line, 4);
    assert.equal(locs[0].range.start.character, 0);
  });

  it('jumps to SGPR, VGPR, and AGPR alias definitions including inside register ranges', () => {
    const provider = new GcnDefinitionProvider();

    // `base` inside `s[base:base+1]` on line 6 -> line 0
    const baseCol = sampleText.split('\n')[6].indexOf('base');
    const baseLocs = provider.provideDefinition(doc, new MockPosition(6, baseCol + 1) as never) as unknown as MockLocation[];
    assert.ok(baseLocs && baseLocs.length === 1);
    assert.equal(baseLocs[0].range.start.line, 0);

    // `v_reg` on line 5 -> line 2
    const vregCol = sampleText.split('\n')[5].indexOf('v_reg');
    const vregLocs = provider.provideDefinition(doc, new MockPosition(5, vregCol + 1) as never) as unknown as MockLocation[];
    assert.ok(vregLocs && vregLocs.length === 1);
    assert.equal(vregLocs[0].range.start.line, 2);

    // `acc_reg` on line 7 -> line 3
    const accCol = sampleText.split('\n')[7].indexOf('acc_reg');
    const accLocs = provider.provideDefinition(doc, new MockPosition(7, accCol + 1) as never) as unknown as MockLocation[];
    assert.ok(accLocs && accLocs.length === 1);
    assert.equal(accLocs[0].range.start.line, 3);
  });
});
