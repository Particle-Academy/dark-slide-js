/**
 * The `dark-slide` command, as a function so it is testable without a build.
 * Node only (it touches the filesystem); `cli.ts` is the executable wrapper.
 *
 *     dark-slide template:convert <input> <output> [--to=document|template] [--force]
 *
 * Exit codes: 0 converted, 1 refused (the reason is printed), 2 usage.
 * Mirrors PHP `DarkSlide\Cli`.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { ArchiveRefused, OfficeTemplateRefused } from "./exceptions";
import { convert, sourceKind, type SourceKind } from "./zip/office-template";
import { DEFAULT_ARCHIVE_LIMITS, SourceArchive } from "./zip/source-archive";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = "Usage: dark-slide template:convert <input> <output> [--to=document|template] [--force]\n"
  + "  Converts a .potx template to its .pptx twin, or back.\n"
  + "  Without --to it flips whichever the input is.\n";

export function run(argv: string[], io: CliIo): number {
  const [command, ...args] = argv;
  const positional: string[] = [];
  let to: string | null = null;
  let force = false;
  for (const arg of args) {
    if (arg.startsWith("--to=")) to = arg.slice(5);
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--")) { io.stderr(`Unknown option ${arg}\n${USAGE}`); return 2; }
    else positional.push(arg);
  }
  if (command !== "template:convert" || positional.length !== 2) {
    io.stderr(USAGE);
    return 2;
  }
  const [input, output] = positional as [string, string];

  if (existsSync(output) && !force) {
    io.stderr(`Refused: ${output} already exists (pass --force to replace it).\n`);
    return 1;
  }
  if (existsSync(input) && existsSync(output) && realpathSync(input) === realpathSync(output)) {
    io.stderr("Refused: the output is the input.\n");
    return 1;
  }

  let converted: Uint8Array;
  try {
    converted = convert(readBounded(input), to as SourceKind | null);
  } catch (error) {
    if (error instanceof OfficeTemplateRefused || error instanceof ArchiveRefused) {
      io.stderr(`Refused (${error.reason}): ${error.message}\n`);
      return 1;
    }
    throw error;
  }

  // Written beside the target and renamed, so a failure leaves no half file.
  const temp = `${output}.tmp-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temp, converted);
    renameSync(temp, output);
  } catch {
    try { unlinkSync(temp); } catch { /* already gone */ }
    io.stderr(`Could not write ${output}.\n`);
    return 1;
  }
  io.stdout(`Wrote ${output} (${sourceKind(SourceArchive.open(converted))}).\n`);
  return 0;
}

/** A regular file no larger than the archive limit, read without over-allocating. */
function readBounded(path: string): Uint8Array {
  let fd: number;
  try { fd = openSync(path, "r"); } catch { throw new ArchiveRefused("archive_path"); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ArchiveRefused("archive_path");
    if (stat.size > DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes) throw new ArchiveRefused("archive_limit");
    const out = new Uint8Array(stat.size);
    let read = 0;
    while (read < out.length) {
      const n = readSync(fd, out, read, out.length - read, read);
      if (n === 0) break;
      read += n;
    }
    return out.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}
