/**
 * Pure markdown transforms: find `<!-- MARKER: command -->` directives and
 * replace the body of the fenced code block that follows each one.
 */

export interface Directive {
  /** 0-based line index of the html comment */
  line: number;
  command: string;
}

export interface CommandResult {
  output: string;
  status: number;
  /** Set when the command never ran (e.g. rejected by the `commands` allowlist) */
  error?: string;
}

export type BlockResult =
  | { directive: Directive; kind: 'updated'; changed: boolean; }
  | { directive: Directive; kind: 'failed'; result: CommandResult; }
  | { directive: Directive; kind: 'missing-codeblock'; };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const directivePattern = (marker: string) =>
  new RegExp(`<!--\\s*${escapeRegExp(marker)}:\\s*(.+?)\\s*-->`);

export function findDirectives(content: string, marker: string): Directive[] {
  const pattern = directivePattern(marker);
  return content.split('\n').flatMap((text, line) => {
    const command = text.match(pattern)?.[1];
    return command ? [{ line, command }] : [];
  });
}

const openingFence = (line: string) => line.match(/^\s*(`{3,}|~{3,})/)?.[1];

/** A closing fence uses the same character, is at least as long, and has nothing after it */
const isClosingFence = (line: string, fence: string) => {
  const match = line.match(/^\s*(`{3,}|~{3,})\s*$/)?.[1];
  return !!match && match[0] === fence[0] && match.length >= fence.length;
};

/**
 * Rewrite every directive's code block using `run`. Failed commands, and
 * directives with no following code block, leave the file untouched there.
 */
export function updateCodeblocks(
  content: string,
  marker: string,
  run: (command: string) => CommandResult,
): { content: string; results: BlockResult[]; } {
  const lines = content.split('\n');
  const directives = findDirectives(content, marker);
  const output: string[] = [];
  const results: BlockResult[] = [];
  let i = 0;

  for (const directive of directives) {
    // copy everything up to and including the comment
    while (i <= directive.line) output.push(lines[i++]!);

    // a code block must follow, with only blank lines between
    let open = i;
    while (open < lines.length && lines[open]!.trim() === '') open++;
    const fence = open < lines.length ? openingFence(lines[open]!) : undefined;
    let close = open + 1;
    while (fence && close < lines.length && !isClosingFence(lines[close]!, fence)) close++;

    // another directive inside the block, or an unterminated block, means it's not ours
    const nextDirective = directives.find(d => d.line > directive.line);
    if (!fence || close >= lines.length || (nextDirective && nextDirective.line < close)) {
      results.push({ directive, kind: 'missing-codeblock' });
      continue;
    }

    const result = run(directive.command);
    if (result.status !== 0 || result.error) {
      results.push({ directive, kind: 'failed', result });
      continue;
    }

    const previous = lines.slice(open + 1, close).join('\n');
    const next = result.output.replace(/\s+$/, '');
    output.push(...lines.slice(i, open + 1));
    if (next !== '') output.push(next);
    output.push(lines[close]!);
    results.push({ directive, kind: 'updated', changed: previous !== next });
    i = close + 1;
  }

  output.push(...lines.slice(i));
  return { content: output.join('\n'), results };
}
