/**
 * A formatter for the `terminal` directive: `greet <args>` in a fenced block of
 * the directive's `lang` (default `sh`), then its output in a ```txt block,
 * and an optional caption from `caption=...`.
 *
 * In your project, import from the package instead:
 *   import { type FormatterContext, fence } from 'cmdsync';
 */
import { type FormatterContext, fence } from '../../../src/custom.ts';

export default function terminal(ctx: FormatterContext): string {
  const caption = ctx.params.caption ? [`*${ctx.params.caption.replaceAll('-', ' ')}*`, ''] : [];
  return [
    ...caption,
    fence(`greet ${ctx.input}`, ctx.lang ?? 'sh'),
    '',
    fence(ctx.output, 'txt'),
  ].join('\n');
}
