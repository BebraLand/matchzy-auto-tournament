import { execFileSync, spawnSync } from 'node:child_process';

const containerName = 'matchzy-postgres';
const proxyName = 'matchzy-postgres-dev-proxy';
const proxyHostPort = '15432';

function docker(args, options = {}) {
  return spawnSync('docker', args, { stdio: 'inherit', ...options });
}

function dockerOutput(args) {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function containerExists(name, runningOnly = false) {
  const command = runningOnly ? 'ps' : 'ps -a';
  return dockerOutput(command.split(' ').concat(['--format', '{{.Names}}']))
    .split(/\r?\n/)
    .includes(name);
}

function publishedPort(name, expectedHostPort = '') {
  try {
    const output = execFileSync('docker', ['port', name, '5432/tcp'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return !expectedHostPort || output.split(/\r?\n/).some((line) => line.endsWith(`:${expectedHostPort}`));
  } catch {
    return false;
  }
}

function networkName(name) {
  const networks = JSON.parse(
    dockerOutput(['inspect', name, '--format', '{{json .NetworkSettings.Networks}}'])
  );
  return Object.keys(networks)[0];
}

function ensureLocalPort() {
  if (publishedPort(containerName)) return;

  if (containerExists(proxyName, true) && publishedPort(proxyName, proxyHostPort)) {
    console.log(`Using existing PostgreSQL bridge '${proxyName}'.`);
    return;
  }

  if (containerExists(proxyName)) {
    const removed = docker(['rm', '-f', proxyName]);
    if (removed.status !== 0) process.exit(removed.status ?? 1);
  }

  const network = networkName(containerName);
  const result = docker([
    'run',
    '-d',
    '--name',
    proxyName,
    '--network',
    network,
    '-p',
    `${proxyHostPort}:5432`,
    'alpine/socat',
    'TCP-LISTEN:5432,fork,reuseaddr',
    'TCP:matchzy-postgres:5432',
  ]);

  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Published PostgreSQL on localhost:${proxyHostPort} through '${proxyName}'.`);
}

try {
  const running = containerExists(containerName, true);

  if (running) {
    ensureLocalPort();
    console.log('PostgreSQL container is already running.');
    process.exit(0);
  }

  const existing = containerExists(containerName);

  const result = existing
    ? docker(['start', containerName])
    : docker([
        'run',
        '-d',
        '--name',
        containerName,
        '-e',
        'POSTGRES_USER=postgres',
        '-e',
        'POSTGRES_PASSWORD=postgres',
        '-e',
        'POSTGRES_DB=matchzy_tournament',
        '-p',
        '5432:5432',
        'postgres:16-alpine',
      ]);

  if (result.status !== 0) process.exit(result.status ?? 1);
  if (existing) ensureLocalPort();
  console.log(existing ? 'Started existing PostgreSQL container.' : 'Created and started PostgreSQL container.');
} catch (error) {
  console.error('Could not prepare PostgreSQL for local development. Is Docker Desktop running?');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
