import { Cell } from "../models/cell";

/** Splits cell prose only at whitespace that is outside Markdown constructs. */
export class MarkdownCellWrapper {
    public wrap(value: string, width: number): string[] {
        if (value.length === 0 || Cell.getDisplayWidth(value) <= width) {
            return [ value ];
        }

        const tokens = this.getTokens(value);
        const lines: string[] = [];
        let current = "";

        for (const token of tokens) {
            const candidate = current.length === 0 ? token : `${current} ${token}`;
            if (current.length === 0 || Cell.getDisplayWidth(candidate) <= width) {
                current = candidate;
            } else {
                lines.push(current);
                current = token;
            }
        }

        if (current.length > 0) {
            lines.push(current);
        }

        // No safe whitespace was found. Keeping the value intact is preferable
        // to breaking Markdown syntax or a word merely to satisfy the limit.
        return lines.length > 0 ? lines : [ value ];
    }

    private getTokens(value: string): string[] {
        const tokens: string[] = [];
        let tokenStart = 0;
        let index = 0;

        while (index < value.length) {
            const constructEnd = this.findConstructEnd(value, index);
            if (constructEnd > index) {
                index = constructEnd;
                continue;
            }

            if (/\s/.test(value[index])) {
                if (tokenStart < index) {
                    tokens.push(value.substring(tokenStart, index));
                }
                while (index < value.length && /\s/.test(value[index])) {
                    index++;
                }
                tokenStart = index;
                continue;
            }

            index++;
        }

        if (tokenStart < value.length) {
            tokens.push(value.substring(tokenStart));
        }

        return tokens;
    }

    private findConstructEnd(value: string, start: number): number {
        if (value[start] === "\\" && start + 1 < value.length) {
            return start + 2;
        }

        if (value[start] === "`") {
            const markerLength = this.countRun(value, start, "`");
            const closingMarker = "`".repeat(markerLength);
            const closingIndex = value.indexOf(closingMarker, start + markerLength);
            return closingIndex < 0 ? value.length : closingIndex + markerLength;
        }

        if (value[start] === "<") {
            const closingIndex = value.indexOf(">", start + 1);
            return closingIndex < 0 ? start : closingIndex + 1;
        }

        const bracketStart = value[start] === "["
            ? start
            : value[start] === "!" && value[start + 1] === "["
                ? start + 1
                : -1;
        if (bracketStart >= 0) {
            const labelEnd = this.findBalancedEnd(value, bracketStart, "[", "]");
            if (labelEnd < 0) {
                return start;
            }

            const destinationStart = labelEnd + 1;
            if (value[destinationStart] === "(") {
                const destinationEnd = this.findBalancedEnd(value, destinationStart, "(", ")");
                return destinationEnd < 0 ? value.length : destinationEnd + 1;
            }
            if (value[destinationStart] === "[") {
                const referenceEnd = this.findBalancedEnd(value, destinationStart, "[", "]");
                return referenceEnd < 0 ? value.length : referenceEnd + 1;
            }

            // A bracketed label may still carry Markdown meaning. Treat it as
            // one unit even when it is a shortcut reference link.
            return labelEnd + 1;
        }

        return start;
    }

    private findBalancedEnd(value: string, start: number, open: string, close: string): number {
        let depth = 0;
        for (let index = start; index < value.length; index++) {
            if (value[index] === "\\") {
                index++;
                continue;
            }
            if (value[index] === open) {
                depth++;
            } else if (value[index] === close && --depth === 0) {
                return index;
            }
        }
        return -1;
    }

    private countRun(value: string, start: number, character: string): number {
        let length = 0;
        while (value[start + length] === character) {
            length++;
        }
        return length;
    }
}
