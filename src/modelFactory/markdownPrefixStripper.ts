import { Cell } from "../models/cell";

export class MarkdownPrefixStripper {

    public strip(text: string): { strippedText: string; prefixes: string[] } {
        const lines = text.match(/[^\n]*\n|[^\n]+/g) || [""];
        const prefixes: string[] = [];
        const strippedLines: string[] = [];

        for (const line of lines) {
            const prefix = this.detectPrefix(line);
            prefixes.push(prefix);
            strippedLines.push(line.substring(prefix.length));
        }

        return { strippedText: strippedLines.join(""), prefixes };
    }

    public restore(text: string, prefixes: string[]): string {
        const lines = text.match(/[^\n]*\n|[^\n]+/g) || [""];
        const result: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const prefix = i < prefixes.length ? prefixes[i] : "";
            result.push(prefix + lines[i]);
        }

        return result.join("");
    }

    public getMaxDisplayWidth(prefixes: string[]): number {
        return prefixes.reduce(
            (maximum, prefix) => Math.max(maximum, Cell.getDisplayWidth(prefix)),
            0
        );
    }

    public resizePrefixes(prefixes: string[], lineCount: number): string[] {
        if (prefixes.length === lineCount) {
            return prefixes.slice();
        }
        if (lineCount <= 0) {
            return [];
        }

        const result: string[] = [];
        if (prefixes.length > 0) {
            result.push(prefixes[0]);
        }
        if (lineCount > 1 && prefixes.length > 1) {
            result.push(prefixes[1]);
        }

        const bodyPrefixes = prefixes.slice(2);
        const continuationPrefix = this.mostCommonPrefix(bodyPrefixes.length > 0
            ? bodyPrefixes
            : prefixes.slice(1));
        while (result.length < lineCount) {
            result.push(continuationPrefix);
        }

        return result;
    }

    private mostCommonPrefix(prefixes: string[]): string {
        if (prefixes.length === 0) {
            return "";
        }

        const counts = new Map<string, number>();
        for (const prefix of prefixes) {
            counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
        }

        return prefixes.reduce((mostCommon, prefix) =>
            counts.get(prefix)! > counts.get(mostCommon)! ? prefix : mostCommon);
    }

    private detectPrefix(line: string): string {
        let prefix = "";
        let remaining = line;

        // Layer 1: Blockquote markers (always strip - unambiguous Markdown syntax)
        const bqMatch = remaining.match(/^([^\S\r\n]*(?:>[^\S\r\n]*)+)/);
        if (bqMatch) {
            prefix += bqMatch[1];
            remaining = remaining.substring(bqMatch[1].length);
        }

        // Layer 2: List markers (only strip when followed by whitespace + |, i.e., bordered tables)
        const listMatch = remaining.match(/^([^\S\r\n]*(?:\d+[.)]|[-*+]))(?=[^\S\r\n]+\|)/);
        if (listMatch) {
            prefix += listMatch[1];
        }

        return prefix;
    }
}
