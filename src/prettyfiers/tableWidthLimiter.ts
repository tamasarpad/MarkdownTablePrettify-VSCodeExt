import { Alignment } from "../models/alignment";
import { Cell } from "../models/cell";
import { Row } from "../models/row";
import { Table } from "../models/table";
import { MarkdownCellWrapper } from "./markdownCellWrapper";

export class TableWidthLimiter {
    constructor(
        private readonly _wrapColumn: number,
        private readonly _columnPadding: number,
        private readonly _cellWrapper: MarkdownCellWrapper = new MarkdownCellWrapper()
    ) { }

    public get isEnabled(): boolean {
        return this._wrapColumn > 0;
    }

    public outputFits(formattedTable: string, prefixWidth: number = 0): boolean {
        return formattedTable
            .split(/\r\n|\r|\n/)
            .every(line => Cell.getDisplayWidth(line) + prefixWidth <= this._wrapColumn);
    }

    public wrap(table: Table, prefixWidth: number = 0): Table {
        const widths = this.allocateColumnWidths(table, prefixWidth);
        if (widths == null) {
            return table;
        }

        const rows: Row[] = [ table.rows[0] ];
        for (let rowIndex = 1; rowIndex < table.rowCount; rowIndex++) {
            const sourceRow = table.rows[rowIndex];
            const fragments = sourceRow.cells.map((cell, column) =>
                this._cellWrapper.wrap(cell.getValue(), widths[column]));
            const fragmentRowCount = Math.max(...fragments.map(values => values.length));

            for (let fragmentIndex = 0; fragmentIndex < fragmentRowCount; fragmentIndex++) {
                rows.push(new Row(
                    fragments.map(values => new Cell(values[fragmentIndex] ?? "")),
                    sourceRow.EOL || table.separatorEOL || "\n"
                ));
            }
        }

        const result = new Table(rows, table.separatorEOL, table.alignments, table.leftPad);
        result.hasLeftBorder = table.hasLeftBorder;
        result.hasRightBorder = table.hasRightBorder;
        return result;
    }

    private allocateColumnWidths(table: Table, prefixWidth: number): number[] | null {
        const availableContentWidth = this._wrapColumn - prefixWidth - this.getFixedWidth(table);
        const minimumWidths = table.rows[0].cells.map((cell, column) => Math.max(
            1,
            cell.getLength(),
            table.alignments[column] === Alignment.NotSet ? 1 : 2
        ));
        const desiredWidths = table.getLongestColumnLengths();

        if (availableContentWidth < minimumWidths.reduce((sum, width) => sum + width, 0)) {
            return null;
        }

        const widths = minimumWidths.slice();
        let remaining = availableContentWidth - widths.reduce((sum, width) => sum + width, 0);

        while (remaining > 0) {
            const activeColumns = widths
                .map((width, column) => ({ column, need: desiredWidths[column] - width }))
                .filter(item => item.need > 0);
            if (activeColumns.length === 0) {
                break;
            }

            const fairShare = Math.max(1, Math.floor(remaining / activeColumns.length));
            for (const item of activeColumns) {
                if (remaining === 0) {
                    break;
                }
                const addition = Math.min(item.need, fairShare, remaining);
                widths[item.column] += addition;
                remaining -= addition;
            }
        }

        return widths;
    }

    private getFixedWidth(table: Table): number {
        const columnCount = table.columnCount;
        const borderWidth = (table.hasLeftBorder ? 1 : 0) + (table.hasRightBorder ? 1 : 0);
        const separatorWidth = columnCount - 1;
        const alignmentPadding = (columnCount * 2)
            - (table.hasLeftBorder ? 0 : 1)
            - (table.hasRightBorder ? 0 : 1);
        const configuredPadding = this._columnPadding
            * ((columnCount * 2) - 1 + (table.hasRightBorder ? 1 : 0));

        return Cell.getDisplayWidth(table.leftPad)
            + borderWidth
            + separatorWidth
            + alignmentPadding
            + configuredPadding;
    }
}
