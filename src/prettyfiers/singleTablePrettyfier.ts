import { ILogger } from "../diagnostics/logger";
import { Document } from "../models/doc/document";
import { Range } from "../models/doc/range";
import { Table } from "../models/table";
import { TableFactory } from "../modelFactory/tableFactory";
import { TableValidator } from "../modelFactory/tableValidator";
import { TableViewModel } from "../viewModels/tableViewModel";
import { TableViewModelFactory } from "../viewModelFactories/tableViewModelFactory";
import { TableStringWriter } from "../writers/tableStringWriter";
import { SizeLimitChecker } from "./sizeLimit/sizeLimitChecker";
import { TableWidthLimiter } from "./tableWidthLimiter";

export class SingleTablePrettyfier {

    constructor(
        private readonly _tableFactory: TableFactory,
        private readonly _tableValidator: TableValidator,
        private readonly _viewModelFactory: TableViewModelFactory,
        private readonly _writer: TableStringWriter,
        private readonly _loggers: ILogger[],
        private readonly _sizeLimitChecker: SizeLimitChecker,
        private readonly _widthLimiter: TableWidthLimiter = new TableWidthLimiter(0, 0)
    ) { }

    public prettifyTable(document: Document, range: Range, prefixWidth: number = 0) : string
    {
        let result: string | null = null;
        let message: string = "";
        const selection: string = document.getText(range);

        try {
            if (!this._sizeLimitChecker.isWithinAllowedSizeLimit(selection)) {
                return selection;
            } else if (this._tableValidator.isValid(selection)) {
                const table: Table = this._tableFactory.getModel(document, range);
                let tableVm: TableViewModel = this._viewModelFactory.build(table);
                result = this._writer.writeTable(tableVm);

                if (this._widthLimiter.isEnabled && !this._widthLimiter.outputFits(result, prefixWidth)) {
                    const wrappedTable = this._widthLimiter.wrap(table, prefixWidth);
                    tableVm = this._viewModelFactory.build(wrappedTable);
                    result = this._writer.writeTable(tableVm);
                }
            } else {
                message = "Can't parse table from invalid text.";
                result = selection;
            }
        } catch (ex: any) {
            this._loggers.forEach(_ => _.logError(ex));
        }

        if (!!message)
            this._loggers.forEach(_ => _.logInfo(message));

        return result!;
    }
}
