import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const packagedDesktopFiles = [
  'main.mjs', 'migrate-saves.mjs', 'model-config.mjs', 'settings-window.mjs',
  'settings-preload.cjs', 'settings.html', 'settings-renderer.mjs', 'settings.css', 'soak-probe.mjs', 'package.json'
];
const required = [
  ...packagedDesktopFiles.map((file) => join(desktopRoot, file)),
  join(desktopRoot, 'package-lock.json'),
  join(desktopRoot, 'build', 'icon.png'),
  join(desktopRoot, 'scripts', 'release-steam.mjs'),
  join(desktopRoot, 'scripts', 'promote-release.mjs'),
  join(desktopRoot, 'scripts', 'release-inputs.mjs'),
  join(desktopRoot, 'scripts', 'release-github.mjs'),
  join(desktopRoot, 'scripts', 'verify-github-candidate.mjs'),
  join(desktopRoot, 'scripts', 'smoke-desktop.mjs'),
  join(desktopRoot, 'scripts', 'pe-signature.mjs'),
  join(desktopRoot, 'scripts', 'verify-steam-candidate.mjs'),
  join(desktopRoot, 'scripts', 'generate-steam-vdf.mjs'),
  join(desktopRoot, 'scripts', 'set-version.mjs'),
  join(projectRoot, 'packages', 'dsh-feitu-world', 'server.mjs'),
  join(projectRoot, 'packages', 'dsh-feitu-world', 'ui', 'preview.html')
];

for (const path of required) await access(path);

const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const packageLock = JSON.parse(await readFile(join(desktopRoot, 'package-lock.json'), 'utf8'));
const runtimePackage = JSON.parse(await readFile(join(projectRoot, 'packages', 'dsh-feitu-world', 'package.json'), 'utf8'));
const runtimeManifest = JSON.parse(await readFile(join(projectRoot, 'packages', 'dsh-feitu-world', 'RELEASE_MANIFEST.json'), 'utf8'));
const mainSource = await readFile(join(desktopRoot, 'main.mjs'), 'utf8');
const forbidden = [/C:\\Users\\/i, /E:\\/i, /DEEPSEEK_API_KEY\s*[:=]\s*['"][^'"]+/i];
const matches = forbidden.filter((pattern) => pattern.test(mainSource));

if (matches.length) throw new Error(`Desktop source contains forbidden machine path or secret pattern: ${matches.join(', ')}`);
for (const file of packagedDesktopFiles) {
  if (!packageJson.build?.files?.includes(file)) throw new Error(`Required desktop file is not explicitly packaged: ${file}`);
}
if (packageJson.build?.win?.target?.[0]?.target !== 'dir') throw new Error('Windows build must remain an unpacked directory for Steam staging.');
if (packageJson.build?.directories?.buildResources !== 'build') throw new Error('Electron build resources must use the checked-in build directory.');
if (packageJson.build?.win?.icon !== 'build/icon.png') throw new Error('Windows release icon is not configured.');
if (packageJson.build?.extraResources?.[0]?.to !== 'player-runtime') throw new Error('Player runtime resource mapping is missing.');
if (packageLock.version !== packageJson.version || packageLock.packages?.['']?.version !== packageJson.version) throw new Error('Desktop package-lock version does not match package.json.');
if (runtimePackage.version !== packageJson.version) throw new Error('Desktop and player runtime versions do not match.');
if (runtimeManifest.release_id !== `dsh-feitu-world@${packageJson.version}`) throw new Error('Runtime release manifest version does not match desktop version.');

console.log(JSON.stringify({
  schema: 'feitu-world/desktop-verify/v1',
  status: 'PASS',
  appId: packageJson.build.appId,
  executableName: packageJson.build.executableName,
  version: packageJson.version,
  versionsAligned: true,
  runtimeSourceAvailable: true,
  machinePathsAbsent: true,
  apiKeyBundled: false
}, null, 2));
