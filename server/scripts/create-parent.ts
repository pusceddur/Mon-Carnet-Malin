// Creates a parent account without prompts. Secrets are read from environment variables named on the command line,
// never from the arguments themselves (they would end up in the shell history and the process list):
//   PARENT_PASSWORD=... PARENT_PIN=... npm run create-parent -- --email parent@example.fr --name "Parent" \
//     --password-env PARENT_PASSWORD --pin-env PARENT_PIN
import { AppError } from '../src/errors';
import { createParentAccount, parseCreateParentArgs } from '../src/auth/createParent';
import { loadConfig, loadEnvFileIfPresent } from '../src/config';
import { createDb, runMigrations } from '../src/db/knex';

const USAGE =
  'Usage: create-parent --email <email> --name <display name> --password-env <VAR> --pin-env <VAR>\n'
  + '  --password-env / --pin-env: names of environment variables holding the password (>= 10 chars) and the PIN (4-8 digits).\n';

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const args = parseCreateParentArgs(process.argv.slice(2));
  if ('error' in args) {
    process.stderr.write(`create-parent: ${args.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const password = process.env[args.passwordEnv];
  const pin = process.env[args.pinEnv];
  if (!password || !pin) {
    process.stderr.write(`create-parent: environment variables ${args.passwordEnv} and ${args.pinEnv} must be set.\n`);
    process.exitCode = 2;
    return;
  }

  const config = loadConfig(process.env);
  const db = createDb(config.databaseUrl);
  try {
    await runMigrations(db);
    const parent = await createParentAccount(
      db,
      { email: args.email, displayName: args.name, password, pin },
      { now: Date.now(), rounds: config.passwordHashRounds },
    );
    process.stdout.write(JSON.stringify({ msg: 'parent_created', id: parent.id, email: parent.email }) + '\n');
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'error';
    const detail = code === 'invalid_request'
      ? 'invalid e-mail, name, password (>= 10 chars) or PIN (4-8 digits)'
      : code === 'email_taken' ? 'this e-mail already has an account' : err instanceof Error ? err.message : String(err);
    process.stderr.write(`create-parent: ${detail}\n`);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`create-parent: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
