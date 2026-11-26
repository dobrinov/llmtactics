// Reaches the production database from this machine, for scripts run by hand.
//
// The database listens only on the server's own 127.0.0.1, so it is reached
// through an SSH tunnel with the same key and host deploy/ship.sh uses
// (LLMTACTICS_HOST, LLMTACTICS_SSH_KEY). Whoever can SSH to the server can do
// this; nobody else can. The address and password are read from the server's
// .env each time and are never written to this machine.
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HOST = process.env.LLMTACTICS_HOST || 'root@89.167.69.250';
const KEY = process.env.LLMTACTICS_SSH_KEY || path.join(os.homedir(), '.ssh', 'hetzner');
const ENV_FILE = '/opt/apps/llmtactics/.env';
const SSH = ['-i', KEY, '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes'];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    }).on('error', reject);
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

// Returns { url, close }: a DATABASE_URL that goes through the tunnel, and a
// function that closes the tunnel.
export async function openProductionTunnel() {
  let remote;
  try {
    remote = execFileSync('ssh', [...SSH, HOST, `grep '^DATABASE_URL=' ${ENV_FILE} | cut -d= -f2-`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    throw new Error(`Could not reach ${HOST} over SSH with ${KEY}: ${String(e.stderr || e.message).trim()}`);
  }
  if (!remote) throw new Error(`No DATABASE_URL in ${ENV_FILE} on the server.`);
  const url = new URL(remote);
  const port = await freePort();
  const tunnel = spawn('ssh', [...SSH, '-N', '-L', `${port}:127.0.0.1:${url.port || 5432}`, HOST], { stdio: 'ignore' });
  let exited = false;
  tunnel.on('exit', () => { exited = true; });
  for (let i = 0; i < 50 && !(await canConnect(port)); i++) {
    if (exited) throw new Error('The SSH tunnel to the production database closed at once.');
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!(await canConnect(port))) { tunnel.kill(); throw new Error('The SSH tunnel to the production database did not open.'); }
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return { url: url.toString(), close: () => tunnel.kill() };
}
