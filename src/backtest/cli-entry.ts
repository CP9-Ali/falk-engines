import { runCli, CLI_USAGE } from './cli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  try {
    const result = await runCli(argv);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write('backtest failed: ' + msg + '\n');
    if (msg.startsWith('missing required args')) {
      process.stderr.write('\n' + CLI_USAGE + '\n');
    }
    process.exit(1);
  }
}

void main();
