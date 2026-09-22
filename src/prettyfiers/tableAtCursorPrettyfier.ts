import * as vscode from "vscode";
import { TableFinder } from "../tableFinding/tableFinder";
import { SingleTablePrettyfier } from "../prettyfiers/singleTablePrettyfier";
import { Document } from "../models/doc/document";
import { Range } from "../models/doc/range";
import { MarkdownPrefixStripper } from "../modelFactory/markdownPrefixStripper";

export class TableAtCursorPrettyfier {

    constructor(
        private readonly _tableFinder: TableFinder,
        private readonly _singleTablePrettyfier: SingleTablePrettyfier,
        private readonly _prefixStripper: MarkdownPrefixStripper = new MarkdownPrefixStripper()
    ) { }

    public async prettifyTableAtCursor(editor: vscode.TextEditor): Promise<boolean> {
        const cursorLine = editor.selection.active.line;
        const { strippedText, prefixes } = this._prefixStripper.strip(editor.document.getText());
        const document = new Document(strippedText);

        const tableRange = this.findTableRangeAtLine(document, cursorLine);
        if (tableRange == null) {
            return false;
        }

        const tablePrefixes = prefixes.slice(tableRange.startLine, tableRange.endLine + 1);
        const prefixWidth = this._prefixStripper.getMaxDisplayWidth(tablePrefixes);
        const formattedTable = prefixWidth > 0
            ? this._singleTablePrettyfier.prettifyTable(document, tableRange, prefixWidth)
            : this._singleTablePrettyfier.prettifyTable(document, tableRange);
        const formattedLineCount = formattedTable.split(/\r\n|\r|\n/).length;
        const formattedTableWithPrefixes = this._prefixStripper.restore(
            formattedTable,
            this._prefixStripper.resizePrefixes(tablePrefixes, formattedLineCount)
        );

        await editor.edit(editBuilder => {
            editBuilder.replace(
                new vscode.Range(
                    new vscode.Position(tableRange.startLine, 0),
                    editor.document.lineAt(tableRange.endLine).range.end
                ),
                formattedTableWithPrefixes
            );
        });

        return true;
    }

    public hasTableAtCursor(document: Document, cursorLine: number): boolean {
        const { strippedText } = this._prefixStripper.strip(document.getText());
        return this.findTableRangeAtLine(new Document(strippedText), cursorLine) != null;
    }

    private findTableRangeAtLine(document: Document, cursorLine: number): Range | null {
        return this._tableFinder.getRangeContainingLine(document, cursorLine);
    }
}
