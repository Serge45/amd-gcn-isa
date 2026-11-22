import * as vscode from 'vscode';
import { findDefinitions, getWordAtPosition, parseDocument } from './symbolParser';

export class GcnDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Location[] | undefined {
    const parsed = parseDocument(document.getText());
    const token = getWordAtPosition(parsed.maskedLines, position.line, position.character);
    if (!token) {
      return undefined;
    }

    const defs = findDefinitions(parsed, token.word, position.line);
    if (defs.length === 0) {
      return undefined;
    }

    return defs.map(
      (def) =>
        new vscode.Location(
          document.uri,
          new vscode.Range(
            new vscode.Position(def.line, def.startCol),
            new vscode.Position(def.line, def.endCol)
          )
        )
    );
  }
}
