import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const proxyName = 'matchzy-postgres-dev-proxy';

function envFileKeys() {
  if (!existsSync('.env')) return new Set();
  return new Set(
    readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
      .filter(Boolean)
  );
}

function proxyPort() {
  try {
    const output = execFileSync('docker', ['port', proxyName, '5432/tcp'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.match(/:(\d+)\s*$/m)?.[1];
  } catch {
    return undefined;
  }
}

function dockerDatabaseUrl() {
  try {
    const output = execFileSync(
      'docker',
      ['inspect', 'matchzy-tournament-api', '--format', '{{range .Config.Env}}{{println .}}{{end}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return output.match(/^DATABASE_URL=(.+)$/m)?.[1];
  } catch {
    return undefined;
  }
}

const keys = envFileKeys();
const env = { ...process.env };
const localDbPort = proxyPort();

if (localDbPort && !env.DATABASE_URL && !env.DB_PORT && !keys.has('DATABASE_URL') && !keys.has('DB_PORT')) {
  env.DB_PORT = localDbPort;
  console.log(`Using PostgreSQL bridge on localhost:${localDbPort}.`);
}

if (!env.DATABASE_URL && !keys.has('DATABASE_URL')) {
  const configuredDockerUrl = dockerDatabaseUrl();
  if (configuredDockerUrl) {
    const hostPort = localDbPort || '5432';
    env.DATABASE_URL = configuredDockerUrl.replace(
      /@([^/:]+):\d+\//,
      `@127.0.0.1:${hostPort}/`
    );
    console.log('Using the running Docker API database credentials for local development.');
  }
}

const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'watch', 'api/src/index.ts'], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code ?? 1);
});
