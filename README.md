# AMDGPU ISA Language Support

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/serge45-md-draw.amdgpu-isa-support.svg)](https://marketplace.visualstudio.com/items?itemName=serge45-md-draw.amdgpu-isa-support)
[![Open VSX](https://img.shields.io/open-vsx/v/serge45-md-draw/amdgpu-isa-support?label=Open%20VSX)](https://open-vsx.org/extension/serge45-md-draw/amdgpu-isa-support)

VS Code language support for AMD GPU assembly files (`.s`, `.S`, `.gcn`), driven directly by the official AMD GPU ISA XML specifications across **CDNA 1–5** and **RDNA 1–4 (including RDNA 3.5)**.

## Features

- **TextMate Syntax Highlighting** (`syntaxes/gcn-asm.tmLanguage.json`):
  - All 2,300+ instructions and aliases from the AMD ISA XML specs (including `_e32`, `_e64`, `_dpp`, `_sdwa` suffixes, case-insensitive).
  - Registers: `s0`–`s105`, `v0`–`v255`, `a0`–`a255`, register ranges (`s[a:b]`, `v[a:b]`, `a[a:b]`), `ttmp*`, and special registers (`vcc`, `exec`, `scc`, `m0`, `null`, `off`, `flat_scratch`, etc.).
  - Labels, assembler directives (`.text`, `.globl`, `.set`, `.equ`, `.equiv`, `.amdhsa_kernel`, `.amdgcn_target`, `.macro`/`.endm`, etc.), preprocessor directives (`#define`, `#include`, etc.), comments (`//`, `/* */`, `;`), numbers, strings, and instruction modifiers (`offset:`, `glc`, `slc`, `dlc`, `sc0`, `sc1`, `nt`, `clamp`, `omod:`, `vmcnt(...)`, `lgkmcnt(...)`, `expcnt(...)`).
- **ISA Hover Documentation**:
  - Hover over any GCN/CDNA/RDNA instruction to view its canonical mnemonic, functional group, encodings, supported architectures (`CDNA1`–`CDNA5`, `RDNA1`–`RDNA4`, `RDNA3.5`), description, syntax, operands table, and aliases.
  - Handles case-insensitivity, `_e32`/`_e64`/`_dpp`/`_sdwa` variants, and legacy/new instruction aliases (e.g. `s_load_dword` / `s_load_b32`, `ds_read_b32` / `ds_load_b32`).
  - Hover over any defined SGPR/VGPR/AGPR or constant alias to inspect its definition and resolved register/value.
- **Go-to-Definition (`Ctrl + Click` / `F12`)**:
  - **Labels**: Jump from branch targets (e.g., `s_branch .L_loop`, `s_cbranch_scc0 target`) to label definitions (`.L_loop:`, `target:`).
  - **SGPR/VGPR/AGPR Aliases**: Jump from any alias identifier (including inside register ranges like `s[base:base+3]`, `v[my_vreg]`, `a[acc_reg]`) to its definition via `.set`, `.equ`, `.equiv`, `=`, or `#define`. Handles redefinitions by preferring the nearest preceding definition.

## Development

### Prerequisites

- Node.js 20+
- AMD GPU ISA XML specs directory (default: `F:\Downloads\AMD_GPU_ISA`)

### Commands

```bash
# Install dependencies
npm install

# Regenerate data/instructions.json and syntaxes/gcn-asm.tmLanguage.json from XML specs
npm run generate

# Override XML directory via CLI arg or environment variable
node scripts/generate.mjs --xml-dir /path/to/AMD_GPU_ISA
AMD_GPU_ISA_DIR=/path/to/AMD_GPU_ISA npm run generate

# Compile TypeScript
npm run compile

# Run automated unit tests
npm test
```

## Project Layout

```text
amd-gcn-isa/
├── data/
│   └── instructions.json          # Generated compact ISA instruction database
├── samples/
│   └── example.s                  # Sample AMDGPU assembly kernel
├── scripts/
│   └── generate.mjs               # XML -> JSON DB & TextMate grammar generator
├── src/
│   ├── extension.ts               # Extension entry point
│   ├── instructionDb.ts           # ISA lookup & Markdown hover formatter
│   ├── symbolParser.ts            # Label & alias parser + expression resolver
│   ├── hoverProvider.ts           # VS Code HoverProvider
│   └── definitionProvider.ts      # VS Code DefinitionProvider
├── syntaxes/
│   └── gcn-asm.tmLanguage.json    # Generated TextMate grammar
├── test/                          # Automated unit tests (node:test)
├── language-configuration.json
├── package.json
└── tsconfig.json
```
