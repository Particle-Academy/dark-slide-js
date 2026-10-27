/**
 * Inline-markdown tokenizer → runs. Mirrors PHP `Helpers\MarkdownInline`.
 *
 * Backslash escapes follow CommonMark: a backslash before any ASCII
 * punctuation character makes that character literal and is removed; a
 * backslash before anything else is a literal backslash. Inside a code span a
 * backslash is always literal.
 */
export interface InlineRun {
  text: string;
  b: boolean;
  i: boolean;
  code: boolean;
}

const isWordChar = (ch: string): boolean => /[a-zA-Z0-9_]/.test(ch);

/**
 * CommonMark's ASCII punctuation set: `!` to `/`, `:` to `@`, `[` to `` ` ``,
 * and `{` to `~`. Takes one UTF-16 code unit; a surrogate half is never in
 * range, so a backslash before non-ASCII stays literal (as in PHP's bytes).
 */
const isAsciiPunctuation = (ch: string): boolean => {
  const o = ch.charCodeAt(0);
  return (o >= 33 && o <= 47) || (o >= 58 && o <= 64) || (o >= 91 && o <= 96) || (o >= 123 && o <= 126);
};

export const MarkdownInline = {
  tokenize(text: string): InlineRun[] {
    const runs: InlineRun[] = [];
    let i = 0;
    const len = text.length;
    let buf = "";
    let b = false;
    let it = false;
    const code = false; // never set as loop state (matches PHP)

    const flush = (): void => {
      if (buf !== "") {
        runs.push({ text: buf, b, i: it, code });
        buf = "";
      }
    };

    while (i < len) {
      const c = text[i]!;
      const next2 = text.slice(i, i + 2);

      // CommonMark backslash escape: before ASCII punctuation the backslash
      // is dropped and the character is literal, so it can never open or
      // close a span. Before anything else the backslash is itself literal
      // and falls through below. Code spans are sliced raw, so nothing is an
      // escape inside one.
      if (c === "\\" && i + 1 < len && isAsciiPunctuation(text[i + 1]!)) {
        buf += text[i + 1]!;
        i += 2;
        continue;
      }

      // Code spans win — they swallow markers literally.
      if (c === "`" && !code) {
        flush();
        const end = text.indexOf("`", i + 1);
        if (end === -1) {
          buf += text.slice(i);
          i = len;
          continue;
        }
        runs.push({ text: text.slice(i + 1, end), b, i: it, code: true });
        i = end + 1;
        continue;
      }

      // Bold via ** or __
      if (next2 === "**" || next2 === "__") {
        flush();
        b = !b;
        i += 2;
        continue;
      }

      // Italic via * or _
      if ((c === "*" || c === "_") && !code) {
        const prev = i > 0 ? text[i - 1]! : " ";
        if ((it && isWordChar(prev)) || !it) {
          if (!it) {
            if (!isWordChar(prev) || prev === " ") {
              flush();
              it = true;
              i++;
              continue;
            }
          } else {
            flush();
            it = false;
            i++;
            continue;
          }
        }
      }

      buf += c;
      i++;
    }

    flush();

    if (runs.length === 0) {
      runs.push({ text: "", b: false, i: false, code: false });
    }

    return runs;
  },

  /** [isBullet, contentWithoutMarker]. */
  bulletPrefix(line: string): [boolean, string] {
    if (line.startsWith("- ") || line.startsWith("* ")) return [true, line.slice(2)];
    return [false, line];
  },

  /** [level (1..6, 0=none), contentWithoutMarker]. */
  headingPrefix(line: string): [number, string] {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) return [m[1]!.length, m[2]!];
    return [0, line];
  },
};
