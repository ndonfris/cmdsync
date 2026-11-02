/**
 * Every diagnostic a (hypothetical) language server reports. Shaped like a
 * real LSP's `src/diagnostics/error-codes.ts`: one constant per code, and a
 * `codes` record holding each code's severity, message and documentation.
 */

/** Same values as `DiagnosticSeverity` from `vscode-languageserver`, inlined so the example has no dependencies */
export const DiagnosticSeverity = { Error: 1, Warning: 2, Information: 3, Hint: 4 } as const;
export type DiagnosticSeverity = typeof DiagnosticSeverity[keyof typeof DiagnosticSeverity];

export namespace ErrorCodes {
  export const missingEnd = 1001;
  export const extraEnd = 1002;
  export const zeroIndexedArray = 1003;

  export const singleQuoteVariableExpansion = 2001;
  export const usedWrapperFunction = 2002;

  export const unusedLocalDefinition = 4004;
  export const duplicateFunctionDefinitionInSameScope = 4006;

  export const deprecatedEnvName = 6001;

  export const syntaxError = 9999;

  export type CodeTypes = 1001 | 1002 | 1003 | 2001 | 2002 | 4004 | 4006 | 6001 | 9999;

  export type CodeValueType = {
    severity: DiagnosticSeverity;
    code: CodeTypes;
    codeDescription: { href: string; };
    source: 'my-lsp';
    isDeprecated?: boolean;
    message: string;
  };

  export const codes: { [k in CodeTypes]: CodeValueType } = {
    [missingEnd]: {
      severity: DiagnosticSeverity.Error,
      code: missingEnd,
      codeDescription: { href: 'https://example.com/docs/end' },
      source: 'my-lsp',
      message: 'missing closing token',
    },
    [extraEnd]: {
      severity: DiagnosticSeverity.Error,
      code: extraEnd,
      codeDescription: { href: 'https://example.com/docs/end' },
      source: 'my-lsp',
      message: 'extra closing token',
    },
    [zeroIndexedArray]: {
      severity: DiagnosticSeverity.Error,
      code: zeroIndexedArray,
      codeDescription: { href: 'https://example.com/docs/arrays#index' },
      source: 'my-lsp',
      message: 'arrays are 1-indexed',
    },
    [singleQuoteVariableExpansion]: {
      severity: DiagnosticSeverity.Warning,
      code: singleQuoteVariableExpansion,
      codeDescription: { href: 'https://example.com/docs/quotes' },
      source: 'my-lsp',
      message: 'variables are not expanded inside single quotes',
    },
    [usedWrapperFunction]: {
      severity: DiagnosticSeverity.Warning,
      code: usedWrapperFunction,
      codeDescription: { href: 'https://example.com/docs/functions#wraps' },
      source: 'my-lsp',
      message: 'wrapper function used where its | piped builtin works',
    },
    [unusedLocalDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: unusedLocalDefinition,
      codeDescription: { href: 'https://example.com/docs/scope' },
      source: 'my-lsp',
      message: 'unused local definition',
    },
    [duplicateFunctionDefinitionInSameScope]: {
      severity: DiagnosticSeverity.Error,
      code: duplicateFunctionDefinitionInSameScope,
      codeDescription: { href: 'https://example.com/docs/functions' },
      source: 'my-lsp',
      message: 'function is defined more than once in the same scope',
    },
    [deprecatedEnvName]: {
      severity: DiagnosticSeverity.Information,
      code: deprecatedEnvName,
      codeDescription: { href: 'https://example.com/docs/env' },
      source: 'my-lsp',
      isDeprecated: true,
      message: 'MY_LSP_LOG is renamed to MY_LSP_LOG_FILE',
    },
    [syntaxError]: {
      severity: DiagnosticSeverity.Error,
      code: syntaxError,
      codeDescription: { href: 'https://example.com/docs/syntax' },
      source: 'my-lsp',
      message: 'syntax error',
    },
  };
}
