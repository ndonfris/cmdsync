/**
 * `cmdsync migrate`: convert an `update-codeblocks` setup, and directives in
 * older cmdsync syntax, to the current one.
 *
 *   <!-- UPDATE_CODEBLOCK: cmd --> + a fenced block   →  <!-- CMDSYNC codeblock: cmd -->
 *   <!-- CMDSYNC[format=x]: cmd --> ... <!-- /CMDSYNC -->  →  <!-- CMDSYNC start format=x: cmd --> ... <!-- CMDSYNC end -->
 *   <!-- CMDSYNC: cmd --> + a fenced block / an end marker  →  `codeblock` / `start`, so the mode is explicit
 *
 * `from` adds markers of other tools (or your own), converted the same way:
 * `<!-- DOCS: cmd -->` + a fenced block, or `<!-- DOCS: cmd -->` ... `<!-- /DOCS -->`.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE, DEFAULT_CONFIG, PACKAGE_JSON_KEY, type UserConfig, defaultEndMarker, findConfig, resolveConfig, validateConfig } from './config.ts';
import { collectFiles, syntaxResolver } from './index.ts';
import { LEGACY_FILES, LEGACY_PACKAGE_JSON_KEY, SCHEMA_URL } from './init.ts';
import { closingFence, codeSpans, ignoredRange, openingFence } from './regions.ts';
import type { CommentSyntax } from './syntax.ts';

/** `update-codeblocks`'s default marker */
export const LEGACY_MARKER = 'UPDATE_CODEBLOCK';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface DirectiveMigration {
  /** Markers to convert (the old directives' names) */
  from: string[];
  /** Marker and end marker to write */
  marker: string;
  endMarker: string;
}

/** A file's new content, or why a directive couldn't be converted */
export interface MigratedText {
  content: string;
  /** Directives rewritten */
  converted: number;
  /** 0-based lines of old directives with neither an end marker nor a fenced block after them */
  unclassified: number[];
}

/** Rewrite old-style directives (and their end markers) in one file */
export function migrateDirectives(content: string, syntax: CommentSyntax, migration: DirectiveMigration): MigratedText {
  const close = syntax.close ? escapeRegExp(syntax.close) : '$';
  const markers = migration.from.map(escapeRegExp).join('|');
  // the old forms only: the marker directly followed by `[options]` or `:`
  const start = new RegExp(`(${escapeRegExp(syntax.open)})(\\s*)(?:${markers})(?:\\[([^\\]]*)\\])?:\\s*(.+?)(\\s*)(${close})`, 'g');
  // `/MARKER`, or already `MARKER end`
  const endAlternatives = migration.from.flatMap(m => [`/${escapeRegExp(m)}`, `${escapeRegExp(m)}\\s+end`]).join('|');
  const end = new RegExp(`(${escapeRegExp(syntax.open)})(\\s*)(?:${endAlternatives})(\\s*)(${close})`, 'g');
  const anyStart = new RegExp(`${escapeRegExp(syntax.open)}\\s*(?:${markers}|${escapeRegExp(migration.marker)})\\b(?!\\s+end\\b)[^\\n]*?:`);

  const lines = content.split('\n');
  const unclassified: number[] = [];
  let converted = 0;
  const outsideCode = (line: string) => {
    const spans = syntax.fences ? codeSpans(line) : [];
    return (index: number) => !spans.some(([a, b]) => index >= a && index < b);
  };
  const rewriteStart = (m: RegExpExecArray, mode: 'start' | 'codeblock') => {
    const [, open, space, rawOptions = '', command, trailing, closing] = m;
    const options = rawOptions.split(',').map(s => s.trim().replace(/\s*=\s*/, '=')).filter(Boolean);
    converted++;
    return `${open}${space || ' '}${[migration.marker, mode, ...options].join(' ')}: ${command}${trailing}${closing}`;
  };
  const rewriteEnds = (text: string) => {
    const ok = outsideCode(text);
    return text.replace(end, (all, open: string, space: string, trailing: string, closing: string, index: number) =>
      ok(index) ? `${open}${space || ' '}${migration.endMarker}${trailing}${closing}` : all);
  };
  const isEnd = (line: string) => [...line.matchAll(end)].some(m => outsideCode(line)(m.index));

  for (let i = 0; i < lines.length; i++) {
    const fence = syntax.fences && openingFence(lines[i]!);
    if (fence) {
      const closeAt = closingFence(lines, i, fence[2]!);
      i = closeAt === -1 ? lines.length : closeAt;
      continue;
    }
    // an ignored range (`MARKER ignore start` … `MARKER ignore end`) stays as written
    const ignored = ignoredRange(lines, i, { ...syntax, marker: migration.marker, endMarker: migration.endMarker });
    if (ignored !== undefined) {
      i = ignored === -1 ? lines.length : ignored;
      continue;
    }
    const line = lines[i]!;
    const ok = outsideCode(line);
    const matches = [...line.matchAll(start)].filter(m => ok(m.index));
    if (matches.length === 0) continue;

    let rewritten = '';
    let last = 0;
    let open: RegExpExecArray | undefined;
    for (const m of matches) {
      const after = line.slice(m.index + m[0].length);
      const inline = isEnd(after.split(start)[0] ?? '');
      rewritten += line.slice(last, m.index);
      if (inline) {
        rewritten += rewriteStart(m, 'start');
      } else {
        open = m;
        rewritten += m[0];
      }
      last = m.index + m[0].length;
    }
    rewritten += line.slice(last);
    lines[i] = rewriteEnds(rewritten);
    if (!open) continue;

    // a block directive: a fenced block right after it (only blank lines between) is a codeblock,
    // an end marker before the next directive is a region
    let next = i + 1;
    while (next < lines.length && lines[next]!.trim() === '') next++;
    let mode: 'start' | 'codeblock' | undefined;
    let endAt = -1;
    if (syntax.fences && next < lines.length && openingFence(lines[next]!)) {
      mode = 'codeblock';
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        const nested = syntax.fences && openingFence(lines[j]!);
        if (nested) {
          const closeAt = closingFence(lines, j, nested[2]!);
          if (closeAt === -1) break;
          j = closeAt;
        } else if (isEnd(lines[j]!)) {
          mode = 'start';
          endAt = j;
          break;
        } else if (anyStart.test(lines[j]!)) {
          break;
        }
      }
    }
    if (!mode) {
      unclassified.push(i);
      continue;
    }
    const m = open;
    lines[i] = lines[i]!.replace(m[0], rewriteStart(m, mode));
    if (endAt !== -1) {
      lines[endAt] = rewriteEnds(lines[endAt]!);
      i = endAt;
    }
  }
  return { content: lines.join('\n'), converted, unclassified };
}

export interface FileMigration {
  file: string;
  before: string;
  /** `null` deletes the file */
  after: string | null;
  notes: string[];
}

export interface MigrationPlan {
  /** Files to write (or delete), in the order to apply them */
  files: FileMigration[];
  /** Things to do by hand */
  notes: string[];
}

const read = (file: string) => readFileSync(file, 'utf-8');

/** Replace the `update-codeblocks` binary in a shell command line */
const renameBinary = (command: string) => command.replace(/(^|[\s;&|(`])update-codeblocks(?=$|[\s;&|)`])/g, '$1cmdsync');

/** Rebuild an object with one key renamed in place, so the key order (and the diff) stays small */
const renameKey = (object: Record<string, unknown>, from: string, to: string, value: unknown) =>
  Object.fromEntries(Object.entries(object).map(([k, v]) => k === from ? [to, value] : [k, v]));

const indentOf = (text: string) => text.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';

/**
 * Everything `cmdsync migrate` would change in the project at `root`, without writing:
 * the config (renamed, legacy marker dropped), `package.json` scripts, GitHub workflows,
 * and directives in every included file.
 */
export function planMigration(root: string, options: { from?: string[]; } = {}): MigrationPlan {
  for (const marker of options.from ?? []) {
    if (!/^[\w.-]+$/.test(marker)) throw new Error(`invalid marker "${marker}" (letters, digits, \`_\`, \`.\` and \`-\`)`);
  }
  const files: FileMigration[] = [];
  const notes: string[] = [];
  const pkgFile = join(root, 'package.json');
  let pkgText = existsSync(pkgFile) ? read(pkgFile) : undefined;
  let pkg = pkgText ? JSON.parse(pkgText) as Record<string, unknown> : undefined;
  const pkgNotes: string[] = [];
  /** package.json edited as text, or undefined to write `pkg` reformatted */
  let pkgEdited: string | undefined = pkgText;

  // 1. the config
  const legacyFile = LEGACY_FILES.map(f => join(root, f)).find(f => existsSync(f));
  const legacyInPkg = pkg && LEGACY_PACKAGE_JSON_KEY in pkg;
  const current = findConfig(root);
  const hasCurrent = current?.root === root;
  let legacy: UserConfig | undefined;
  if ((legacyFile || legacyInPkg) && hasCurrent) {
    notes.push(`both an update-codeblocks config and ${current!.source} exist: merge the update-codeblocks one into it by hand, then delete it`);
  } else if (legacyFile) {
    const { $schema: _, ...json } = JSON.parse(read(legacyFile)) as Record<string, unknown>;
    legacy = validateConfig(json, legacyFile);
    const { marker: _marker, ...rest } = legacy;
    files.push({ file: legacyFile, before: read(legacyFile), after: null, notes: [`replaced by ${CONFIG_FILE}`] });
    files.push({ file: join(root, CONFIG_FILE), before: '', after: `${JSON.stringify({ $schema: SCHEMA_URL, ...rest }, null, 2)}\n`, notes: ['from update-codeblocks config'] });
  } else if (legacyInPkg) {
    legacy = validateConfig(pkg![LEGACY_PACKAGE_JSON_KEY], `${pkgFile}#${LEGACY_PACKAGE_JSON_KEY}`);
    const { marker: _marker, ...rest } = legacy;
    pkg = renameKey(pkg!, LEGACY_PACKAGE_JSON_KEY, PACKAGE_JSON_KEY, rest);
    // edit the text, so the rest of package.json keeps its formatting; reformat only when `marker` has to go
    const renamed = pkgText!.replace(new RegExp(`"${LEGACY_PACKAGE_JSON_KEY}"(\\s*:\\s*\\{)`), `"${PACKAGE_JSON_KEY}"$1`);
    pkgEdited = legacy.marker === undefined ? renamed : undefined;
    pkgNotes.push(`"${LEGACY_PACKAGE_JSON_KEY}" key → "${PACKAGE_JSON_KEY}"`);
  }

  // 2. package.json scripts and the dependency
  if (pkg) {
    const scripts = pkg.scripts as Record<string, string> | undefined;
    if (scripts && typeof scripts === 'object') {
      const renamed = Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, typeof v === 'string' ? renameBinary(v) : v]));
      if (JSON.stringify(renamed) !== JSON.stringify(scripts)) {
        pkg.scripts = renamed;
        for (const [key, value] of Object.entries(scripts)) {
          if (pkgEdited === undefined || renamed[key] === value) continue;
          const at = new RegExp(`(${escapeRegExp(JSON.stringify(key))}\\s*:\\s*)${escapeRegExp(JSON.stringify(value))}`);
          pkgEdited = at.test(pkgEdited) ? pkgEdited.replace(at, `$1${JSON.stringify(renamed[key])}`) : undefined;
        }
        pkgNotes.push('scripts: update-codeblocks → cmdsync');
      }
    }
    for (const deps of ['dependencies', 'devDependencies'] as const) {
      const table = pkg[deps] as Record<string, string> | undefined;
      if (table && 'update-codeblocks' in table) {
        notes.push(`replace the dependency: \`yarn remove update-codeblocks && yarn add ${deps === 'devDependencies' ? '-D ' : ''}cmdsync\` (or the npm/pnpm equivalent)`);
      }
    }
    const after = pkgEdited ?? `${JSON.stringify(pkg, null, indentOf(pkgText!))}\n`;
    if (pkgNotes.length > 0) files.push({ file: pkgFile, before: pkgText!, after, notes: pkgNotes });
    pkgText = after;
  }

  // 3. GitHub workflows using the old action
  const workflows = globSync(['.github/workflows/*.yml', '.github/workflows/*.yaml'], { cwd: root }).map(f => join(root, f));
  for (const file of workflows.sort()) {
    const before = read(file);
    const after = before
      .replace(/ndonfris\/(?:fish-lsp\/packages\/update-codeblocks|update-codeblocks)@[\w./-]+/g, 'ndonfris/cmdsync@master')
      .replace(/\bupdate-codeblocks\.json\b/g, CONFIG_FILE)
      .replace(/(\bnpx\s+|\byarn\s+|\bpnpm\s+(?:exec\s+)?|\bbunx\s+)update-codeblocks\b/g, '$1cmdsync');
    if (after !== before) files.push({ file, before, after, notes: ['action and CLI renamed to cmdsync'] });
  }

  // 4. directives, with the config as it will be after the migration
  const marker = current && hasCurrent ? resolveConfig({ cwd: root }).marker : DEFAULT_CONFIG.marker;
  const config = resolveConfig({ cwd: root, overrides: legacy ? { ...legacy, marker } : {} });
  const explicitEnd = hasCurrent && current!.config.endMarker !== undefined;
  const from = [...new Set([...legacy ? [legacy.marker ?? LEGACY_MARKER] : [], ...options.from ?? [], marker])];
  const migration = { from, marker, endMarker: explicitEnd ? config.endMarker : defaultEndMarker(marker) };
  const syntaxFor = syntaxResolver(config);
  for (const file of collectFiles(config)) {
    const syntax = syntaxFor(file);
    if (!syntax) continue;
    const before = files.find(f => f.file === file)?.after ?? read(file);
    if (!from.some(m => before.includes(m))) continue;
    const result = migrateDirectives(before, syntax, migration);
    const fileNotes = result.unclassified.map(line => `line ${line + 1}: no end marker or fenced block follows this directive, left as is`);
    if (result.content !== before || fileNotes.length > 0) {
      const existing = files.find(f => f.file === file);
      if (existing) {
        existing.after = result.content;
        existing.notes.push(`${result.converted} directive(s)`, ...fileNotes);
      } else {
        files.push({ file, before, after: result.content, notes: [`${result.converted} directive(s)`, ...fileNotes] });
      }
    }
  }
  return { files: files.filter(f => f.after !== f.before || f.notes.some(n => n.startsWith('line '))), notes };
}
