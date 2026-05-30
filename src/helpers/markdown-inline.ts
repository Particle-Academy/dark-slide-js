/** Inline-markdown tokenizer → runs. Mirrors PHP `Helpers\MarkdownInline`. */
export interface InlineRun {
  text: string;
  b: boolean;
  i: boolean;
  code: boolean;
}

const isWordChar = (ch: string): boolean => /[a-zA-Z0-9_]/.test(ch);

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
