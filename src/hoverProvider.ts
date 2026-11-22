import * as vscode from 'vscode';
import { InstructionDb } from './instructionDb';
import {
  findDefinitions,
  formatAliasHoverMarkdown,
  getWordAtPosition,
  parseDocument,
} from './symbolParser';

export class GcnHoverProvider implements vscode.HoverProvider {
  constructor(private readonly db: InstructionDb) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | undefined {
    const parsed = parseDocument(document.getText());
    const token = getWordAtPosition(parsed.maskedLines, position.line, position.character);
    if (!token) {
      return undefined;
    }

    const range = new vscode.Range(
      new vscode.Position(token.line, token.startCol),
      new vscode.Position(token.line, token.endCol)
    );

    // 1. Check ISA instruction database first
    const instResult = this.db.lookup(token.word);
    if (instResult) {
      const md = new vscode.MarkdownString(this.db.formatHoverMarkdown(instResult));
      md.isTrusted = false;
      return new vscode.Hover(md, range);
    }

    // 2. Bonus: check defined SGPR/VGPR/AGPR or constant alias
    const defs = findDefinitions(parsed, token.word, position.line);
    const aliasDef = defs.find((d) => d.kind === 'alias');
    if (aliasDef) {
      const md = new vscode.MarkdownString(formatAliasHoverMarkdown(parsed, aliasDef));
      md.isTrusted = false;
      return new vscode.Hover(md, range);
    }

    return undefined;
  }
}
