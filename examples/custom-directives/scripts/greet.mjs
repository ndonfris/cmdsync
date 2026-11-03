#!/usr/bin/env node
// A stand-in CLI for the example: deterministic output, so the docs stay in sync everywhere
const [command, ...args] = process.argv.slice(2);
if (command === '--version') console.log('greet 2.4.0');
else if (command === '--help') console.log('Usage: greet [--version] [--help] <name>\n\n  Prints a greeting.');
else console.log(`Hello, ${[command, ...args].join(' ') || 'world'}!`);
