import * as path from 'node:path';
import * as vscode from 'vscode';
import { InstructionDb } from './instructionDb';
import { GcnHoverProvider } from './hoverProvider';
import { GcnDefinitionProvider } from './definitionProvider';

const LANGUAGE_SELECTOR: vscode.DocumentSelector = [
  { language: 'gcn-asm', scheme: 'file' },
  { language: 'gcn-asm', scheme: 'untitled' },
];

export function activate(context: vscode.ExtensionContext): void {
  const dbPath = path.join(context.extensionPath, 'data', 'instructions.json');
  const db = InstructionDb.loadFromFile(dbPath);

  const hoverProvider = vscode.languages.registerHoverProvider(
    LANGUAGE_SELECTOR,
    new GcnHoverProvider(db)
  );

  const definitionProvider = vscode.languages.registerDefinitionProvider(
    LANGUAGE_SELECTOR,
    new GcnDefinitionProvider()
  );

  context.subscriptions.push(hoverProvider, definitionProvider);
}

export function deactivate(): void {
  // No-op
}
