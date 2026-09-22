import { Document } from "../models/doc/document";
import { Range } from "../models/doc/range";
import { TableFinder } from "../tableFinding/tableFinder";
import { SizeLimitChecker } from "./sizeLimit/sizeLimitChecker";
import { SingleTablePrettyfier } from "./singleTablePrettyfier";
import { MarkdownPrefixStripper } from "../modelFactory/markdownPrefixStripper";

export class MultiTablePrettyfier {
    constructor(
        private readonly _tableFinder: TableFinder,
        private readonly _singleTablePrettyfier: SingleTablePrettyfier,
        private readonly _sizeLimitChecker: SizeLimitChecker,
        private readonly _prefixStripper: MarkdownPrefixStripper = new MarkdownPrefixStripper()
    ) { }

    public formatTables(input: string): string
    {
        if (!this._sizeLimitChecker.isWithinAllowedSizeLimit(input)) {
            return input;
        }

        const { strippedText, prefixes } = this._prefixStripper.strip(input);

        let document = new Document(strippedText);
        let tableRange: Range | null = null;
        let tableSearchStartLine = 0;

        while ((tableRange = this._tableFinder.getNextRange(document, tableSearchStartLine)) != null) {
            const tablePrefixes = prefixes.slice(tableRange.startLine, tableRange.endLine + 1);
            const prefixWidth = this._prefixStripper.getMaxDisplayWidth(tablePrefixes);
            const formattedTable: string = prefixWidth > 0
                ? this._singleTablePrettyfier.prettifyTable(document, tableRange, prefixWidth)
                : this._singleTablePrettyfier.prettifyTable(document, tableRange);
            const replacementRange = document.replaceTextInRange(tableRange, formattedTable);
            const replacementPrefixes = this._prefixStripper.resizePrefixes(
                tablePrefixes,
                replacementRange.endLine - replacementRange.startLine + 1
            );
            prefixes.splice(tableRange.startLine, tableRange.endLine - tableRange.startLine + 1, ...replacementPrefixes);
            tableSearchStartLine = replacementRange.endLine + 1;
        }

        return this._prefixStripper.restore(document.getText(), prefixes);
    }
}
