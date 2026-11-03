/**
 * A formatter for the `terminal` directive: `greet <args>` in a fenced block of
 * the directive's `lang` (default `sh`), then its output in a ```txt block,
 * and an optional caption from `caption=...`.
 *
 * In your project, import the types from the package instead:
 *   import { defineFormatter } from 'cmdsync';
 */
import type { FormatterContext } from '../../../src/custom.ts';

export default function terminal(ctx: FormatterContext): string {
  const caption = ctx.params.caption ? [`*${ctx.params.caption.replaceAll('-', ' ')}*`, ''] : [];
  return [
    ...caption,
    ctx.fence(`greet ${ctx.cmd}`, ctx.lang ?? 'sh'),
    '',
    ctx.fence(ctx.output, 'txt'),
  ].join('\n');
}
