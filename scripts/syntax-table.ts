/** Prints the built-in comment syntax table as JSON, for the README's `format=md-table` region */
import { BUILTIN_SYNTAX, BY_BASENAME, type CommentSyntax } from '../src/syntax.js';

const delimiters = ({ open, close }: CommentSyntax) => `\`${open}\`${close ? ` … \`${close}\`` : ''}`;
const names = (list: string[]) => list.map(name => `\`${name}\``).join(' ');

const rows = BUILTIN_SYNTAX.map(([syntax, extensions]) => ({
  Comment: delimiters(syntax),
  Markdown: syntax.fences ? 'yes' : '',
  Files: names(extensions.map(ext => `.${ext}`).concat(
    [...BY_BASENAME].filter(([, s]) => s.open === syntax.open && s.close === syntax.close).map(([name]) => name),
  )),
}));

console.log(JSON.stringify(rows));
