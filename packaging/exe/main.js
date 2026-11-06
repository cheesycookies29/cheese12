// Entry point of the single-file Windows app (CORE-ERP.exe), built by scripts/build-exe.sh.
// The .exe carries Node.js, the server and every web file. On start it unpacks the web files
// to a folder on this PC, keeps the database there too, starts the server and opens the browser.
//
//   CORE-ERP.exe                          start on this computer only and open the browser
//   CORE-ERP.exe --network                also let other computers on the office network sign in
//   CORE-ERP.exe --port 3001              use another port
//   CORE-ERP.exe --no-browser             don't open the browser
//   CORE-ERP.exe --reset-password <user> <new password>
//
// Data lives in %LOCALAPPDATA%\CORE ERP (or a "CORE-data" folder next to the .exe, if there is
// one: portable mode, e.g. on a USB drive; or CORE_DATA_DIR).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { exec } from 'node:child_process';
import seaModule from 'node:sea';

const APP_NAME = 'CORE · ERP by Lancaster';
process.title = APP_NAME;

const sea = seaModule?.isSea?.() ? seaModule : null;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// Keep the window open on errors so people can read them before it closes.
async function pauseAndExit(code) {
  if (process.stdin.isTTY && process.platform === 'win32') {
    console.log('\n  Press Enter to close this window.');
    await new Promise((resolve) => process.stdin.once('data', resolve));
  }
  process.exit(code);
}
process.on('uncaughtException', (err) => {
  console.error(`\n  ${APP_NAME} stopped because of an error:\n  ${err?.stack || err}`);
  pauseAndExit(1);
});

async function main() {
  if (flag('--help') || flag('-h') || flag('/?')) {
    console.log(`\n  ${APP_NAME}\n
    CORE-ERP.exe                           start and open the browser
    CORE-ERP.exe --network                 let other computers on the network sign in
    CORE-ERP.exe --port 3001               use another port (default 3000)
    CORE-ERP.exe --no-browser              don't open the browser
    CORE-ERP.exe --reset-password <username> <new password>\n`);
    process.exit(0);
  }

  // ----- Where data and the web files go -----
  const exeDir = path.dirname(process.execPath);
  const portable = path.join(exeDir, 'CORE-data');
  const home =
    process.env.CORE_DATA_DIR ||
    (fs.existsSync(portable) ? portable : null) ||
    (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'CORE ERP') : path.join(os.homedir(), '.core-erp'));
  const dataDir = path.join(home, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // The web files (public/, shared/) are inside the .exe; unpack them once per build.
  function unpack() {
    if (!sea) return null; // running from source: use the checkout
    const manifest = JSON.parse(sea.getAsset('manifest.json', 'utf8'));
    const appDir = path.join(home, 'app', manifest.build);
    const marker = path.join(appDir, '.complete');
    if (!fs.existsSync(marker)) {
      fs.rmSync(appDir, { recursive: true, force: true });
      for (const rel of manifest.files) {
        const target = path.join(appDir, ...rel.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(sea.getAsset(rel)));
      }
      fs.writeFileSync(path.join(appDir, 'build.json'), JSON.stringify({ ...manifest.buildInfo, installedAt: new Date().toISOString() }));
      fs.writeFileSync(marker, manifest.build);
    }
    // Remove the files of earlier builds.
    for (const old of fs.readdirSync(path.join(home, 'app'))) {
      if (old !== manifest.build) fs.rmSync(path.join(home, 'app', old), { recursive: true, force: true });
    }
    return appDir;
  }

  const appDir = unpack();
  if (appDir) process.env.CORE_APP_DIR = appDir;
  process.env.DB_FILE = process.env.DB_FILE || path.join(dataDir, 'db.json');

  // ----- Emergency password reset -----
  if (flag('--reset-password')) {
    const [username, password] = [option('--reset-password'), args[args.indexOf('--reset-password') + 2]];
    process.argv = [process.argv[0], 'reset-password', username, password].filter((x) => x !== undefined);
    try {
      await import('../../scripts/reset-password.js');
    } finally {
      await pauseAndExit(0);
    }
  }

  // ----- Start the server -----
  const port = Number(option('--port') || process.env.PORT || 3000);
  process.env.PORT = String(port);
  if (flag('--network')) process.env.HOST = '0.0.0.0';
  if (!flag('--no-browser')) process.env.OPEN_BROWSER = '1';
  const url = `http://localhost:${port}`;

  // Started twice? Open the copy that is already running instead of failing.
  const running = await new Promise((resolve) => {
    const req = http.get(`${url}/api/auth/status`, { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => (req.destroy(), resolve(false)));
  });
  if (running) {
    console.log(`\n  ${APP_NAME} is already running at ${url}. Opening it in your browser.`);
    if (process.env.OPEN_BROWSER) exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`, () => {});
    setTimeout(() => process.exit(0), 3000);
  } else {
    console.log(`\n  ${APP_NAME}`);
    console.log(`  Your data is stored on this computer in: ${home}`);
    if (flag('--network')) {
      const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      if (ips.length) console.log(`  Other computers can open: ${ips.map((ip) => `http://${ip}:${port}`).join('  or  ')}`);
      console.log('  If Windows Firewall asks, allow access on Private networks only.');
    }
    console.log('  Keep this window open while you use CORE. Close it to stop.');
    await import('../../server.js');
  }
}

main();
