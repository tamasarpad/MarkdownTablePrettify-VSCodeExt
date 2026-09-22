import * as assert from "assert";
import * as vscode from "vscode";
import { AlignmentFactory } from "../../../src/modelFactory/alignmentFactory";
import { SelectionInterpreter } from "../../../src/modelFactory/selectionInterpreter";
import { FairTableIndentationDetector } from "../../../src/modelFactory/tableIndentationDetector";
import { TableFactory } from "../../../src/modelFactory/tableFactory";
import { TableValidator } from "../../../src/modelFactory/tableValidator";
import { BorderTransformer } from "../../../src/modelFactory/transformers/borderTransformer";
import { TrimmerTransformer } from "../../../src/modelFactory/transformers/trimmerTransformer";
import { Cell } from "../../../src/models/cell";
import { ContentPadCalculator } from "../../../src/padCalculation/contentPadCalculator";
import { PadCalculatorSelector } from "../../../src/padCalculation/padCalculatorSelector";
import { MultiTablePrettyfier } from "../../../src/prettyfiers/multiTablePrettyfier";
import { NoSizeLimitChecker } from "../../../src/prettyfiers/sizeLimit/noSizeLimitChecker";
import { SingleTablePrettyfier } from "../../../src/prettyfiers/singleTablePrettyfier";
import { TableAtCursorPrettyfier } from "../../../src/prettyfiers/tableAtCursorPrettyfier";
import { TableWidthLimiter } from "../../../src/prettyfiers/tableWidthLimiter";
import { TableFinder } from "../../../src/tableFinding/tableFinder";
import { AlignmentMarkerStrategy } from "../../../src/viewModelFactories/alignmentMarking";
import { RowViewModelFactory } from "../../../src/viewModelFactories/rowViewModelFactory";
import { TableViewModelFactory } from "../../../src/viewModelFactories/tableViewModelFactory";
import { TableStringWriter } from "../../../src/writers/tableStringWriter";
import { ValuePaddingProvider } from "../../../src/writers/valuePaddingProvider";
import { MarkdownTextDocumentStub } from "../../stubs/markdownTextDocumentStub";

suite("Width-limited table formatting", () => {
    test("a short table uses upstream formatting without continuation rows", () => {
        const result = createFormatter(60).formatTables("| A | B |\n|-|-|\n|one|two|");

        assert.strictEqual(result, "| A   | B   |\n|-----|-----|\n| one | two |");
        assert.strictEqual(result.split("\n").length, 3);
    });

    test("long prose wraps into aligned continuation rows within the limit", () => {
        const limit = 54;
        const input = "| Input | Agreed behavior |\n|-|-|\n| Ordinary inline image | Recognize for image conversion, subject to ownership and GitHub consent rules. |";
        const result = createFormatter(limit).formatTables(input);
        const lines = result.split("\n");

        assert.ok(lines.length > 3);
        assert.ok(lines.every(line => Cell.getDisplayWidth(line) <= limit), result);
        assertPipesAligned(lines);
        assert.strictEqual(formatAgain(result, limit), result);
    });

    test("two long cells retain text in their own columns and original order", () => {
        const input = "| First | Second |\n|-|-|\n| alpha beta gamma delta epsilon zeta eta theta | one two three four five six seven eight nine |";
        const result = createFormatter(42).formatTables(input);
        const bodyCells = getBodyCells(result);

        assert.strictEqual(bodyCells.map(row => row[0]).filter(Boolean).join(" "), "alpha beta gamma delta epsilon zeta eta theta");
        assert.strictEqual(bodyCells.map(row => row[1]).filter(Boolean).join(" "), "one two three four five six seven eight nine");
    });

    test("a legitimate row with an empty first cell is preserved", () => {
        const input = "| Key | Details |\n|-|-|\n| | deliberately blank key |\n| named | more details |";
        const result = createFormatter(80).formatTables(input);
        const bodyCells = getBodyCells(result);

        assert.strictEqual(bodyCells.length, 2);
        assert.strictEqual(bodyCells[0][0], "");
        assert.strictEqual(bodyCells[0][1], "deliberately blank key");
    });

    test("an indivisible Markdown construct stays intact even when it exceeds the limit", () => {
        const link = "[a deliberately long link label](https://example.com/a/very/long/destination)";
        const result = createFormatter(32).formatTables(`| A | B |\n|-|-|\n| value | ${link} tail |`);

        assert.ok(result.includes(link));
        assert.ok(result.split("\n").some(line => Cell.getDisplayWidth(line) > 32));
    });

    test("a header that cannot fit is not split and remains a valid table", () => {
        const header = "A header that is much longer than the configured limit";
        const result = createFormatter(30).formatTables(`| ${header} | B |\n|-|-|\n| body text that can wrap | value |`);

        assert.ok(result.split("\n")[0].includes(header));
        assert.ok(new TableValidator(new SelectionInterpreter(true)).isValid(result));
    });

    test("multiple expanding tables format without changing text between them", () => {
        const prose = "\n\nText between tables must stay byte-for-byte.\n\n";
        const tableOne = "| A | B |\n|-|-|\n| one | alpha beta gamma delta epsilon zeta eta theta iota |";
        const tableTwo = "| C | D |\n|-|-|\n| two | one two three four five six seven eight nine ten |";
        const result = createFormatter(38).formatTables(tableOne + prose + tableTwo);

        assert.ok(result.includes(prose));
        assert.strictEqual((result.match(/^\|-+/gm) ?? []).length, 2);
        assert.ok(result.split("\n").length > (tableOne + prose + tableTwo).split("\n").length);
    });

    test("LF, CRLF, indentation, escaped pipes, inline-code pipes, and ignore regions are preserved", () => {
        for (const eol of [ "\n", "\r\n" ]) {
            const ignored = "<!-- markdown-table-prettify-ignore-start -->" + eol
                + "| untouched|table |" + eol + "|-|-|" + eol + "| x|y |" + eol
                + "<!-- markdown-table-prettify-ignore-end -->";
            const input = `  | A | B |${eol}  |-|-|${eol}  | \\| and \`x|y\` | alpha beta gamma delta epsilon zeta eta theta |${eol}${ignored}${eol}`;
            const result = createFormatter(48).formatTables(input);

            assert.ok(result.includes("\\|"));
            assert.ok(result.includes("`x|y`"));
            assert.ok(result.includes(ignored));
            assert.ok(result.split(eol).filter(line => line.includes("| A") || line.includes("alpha") || line.includes("theta")).every(line => line.startsWith("  |")));
            assert.strictEqual(result.endsWith(eol), true);
            assert.strictEqual(eol === "\r\n" ? result.replace(/\r\n/g, "").includes("\n") : false, false);
        }
    });

    test("the cursor command edits exactly the containing table, including from a continuation row", async () => {
        const first = createFormatter(38).formatTables("| A | B |\n|-|-|\n| one | alpha beta gamma delta epsilon zeta eta theta iota |");
        const input = `${first}\n\nunchanged\n\n| C | D |\n|-|-|\n| x | y |`;
        const document = new MarkdownTextDocumentStub(input);
        let replacement: { range: vscode.Range, text: string } | null = null;
        const editor = {
            document,
            selection: new vscode.Selection(3, 0, 3, 0),
            edit: async (callback: (builder: vscode.TextEditorEdit) => void) => {
                callback(<vscode.TextEditorEdit><unknown>{
                    replace: (range: vscode.Range, text: string) => { replacement = { range, text }; }
                });
                return true;
            }
        } as unknown as vscode.TextEditor;

        const changed = await createCursorFormatter(38).prettifyTableAtCursor(editor);

        assert.strictEqual(changed, true);
        assert.ok(replacement != null);
        const actual = replacement as unknown as { range: vscode.Range, text: string };
        assert.strictEqual(actual.range.start.line, 0);
        assert.strictEqual(actual.range.end.line, first.split("\n").length - 1);
        assert.strictEqual(actual.text, first);
        assert.ok(!actual.text.includes("unchanged"));
        assert.ok(!actual.text.includes("| C"));
    });

    function createFormatter(wrapColumn: number): MultiTablePrettyfier {
        const finder = createFinder();
        return new MultiTablePrettyfier(finder, createSingleFormatter(wrapColumn), new NoSizeLimitChecker());
    }

    function createCursorFormatter(wrapColumn: number): TableAtCursorPrettyfier {
        return new TableAtCursorPrettyfier(createFinder(), createSingleFormatter(wrapColumn));
    }

    function createFinder(): TableFinder {
        return new TableFinder(new TableValidator(new SelectionInterpreter(true)));
    }

    function createSingleFormatter(wrapColumn: number): SingleTablePrettyfier {
        const columnPadding = 0;
        return new SingleTablePrettyfier(
            new TableFactory(
                new AlignmentFactory(),
                new SelectionInterpreter(false),
                new TrimmerTransformer(new BorderTransformer(null)),
                new FairTableIndentationDetector()
            ),
            new TableValidator(new SelectionInterpreter(false)),
            new TableViewModelFactory(new RowViewModelFactory(
                new ContentPadCalculator(new PadCalculatorSelector(), " "),
                new AlignmentMarkerStrategy(":")
            )),
            new TableStringWriter(new ValuePaddingProvider(columnPadding)),
            [],
            new NoSizeLimitChecker(),
            new TableWidthLimiter(wrapColumn, columnPadding)
        );
    }

    function formatAgain(value: string, wrapColumn: number): string {
        return createFormatter(wrapColumn).formatTables(value);
    }

    function assertPipesAligned(lines: string[]): void {
        const pipePositions = lines.map(line => Array.from(line.matchAll(/\|/g), match => match.index));
        for (const positions of pipePositions.slice(1)) {
            assert.deepStrictEqual(positions, pipePositions[0]);
        }
    }

    function getBodyCells(table: string): string[][] {
        return table.split(/\r\n|\r|\n/).slice(2).map(line => {
            const cells = new SelectionInterpreter(false).splitLine(line);
            if (cells[0]?.trim() === "") cells.shift();
            if (cells[cells.length - 1]?.trim() === "") cells.pop();
            return cells.map(cell => cell.trim());
        });
    }
});
