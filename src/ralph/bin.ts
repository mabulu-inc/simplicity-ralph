#!/usr/bin/env node
import { createRequire } from 'node:module';
import { dispatch, formatHelp, formatCommandHelp } from './cli.js';

async function main(): Promise<void> {
  const result = dispatch(process.argv.slice(2));

  if (result.action === 'version') {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version: string };
    console.log(pkg.version);
    return;
  }

  if (result.action === 'help') {
    if (result.command) {
      console.log(formatCommandHelp(result.command));
    } else if (result.unknown) {
      console.error(formatHelp(result.unknown));
      process.exitCode = 1;
    } else {
      console.log(formatHelp());
    }
    return;
  }

  const { run } = await import(`./commands/${result.action}.js`);
  await run(result.args);
}

main();
