// STUB: server-platform
// Intended usage: npm run create-parent -- --email parent@example.fr --name "Parent" --password "..." --pin 1234
import { parseArgs } from 'node:util';

function main(): void {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      password: { type: 'string' },
      pin: { type: 'string' },
    },
    strict: false,
  });
  void values;
  process.stderr.write('create-parent: not implemented yet (owner: server-platform).\n');
  process.exitCode = 1;
}

main();
