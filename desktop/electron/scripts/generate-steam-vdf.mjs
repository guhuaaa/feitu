import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const steamRoot = join(projectRoot, 'release', 'staging', 'steam-windows');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function requireNumericId(name, value) {
  if (!/^[1-9]\d{0,9}$/.test(value ?? '') || BigInt(value) > 4294967295n) throw new Error(`${name} must be a positive uint32 Steamworks ID (1..4294967295).`);
  return value;
}

function vdfPath(path) {
  return path.replaceAll('\\', '/');
}

const args = parseArgs(process.argv.slice(2));
const appId = requireNumericId('app-id', args['app-id'] ?? process.env.FEITU_STEAM_APP_ID);
const depotId = requireNumericId('depot-id', args['depot-id'] ?? process.env.FEITU_STEAM_DEPOT_ID);
if (appId === depotId) throw new Error('Steam App ID and Depot ID must be different.');

const branch = args.branch ?? process.env.FEITU_STEAM_BRANCH ?? 'beta';
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(branch)) throw new Error('branch may contain only letters, digits, underscore, and hyphen.');
if (['default', 'public'].includes(branch.toLowerCase())) {
  throw new Error('Automatic promotion to the default/public branch is forbidden; promote a tested build manually in Steamworks.');
}

const previewValue = args.preview ?? process.env.FEITU_STEAM_PREVIEW ?? '1';
if (!['0', '1'].includes(previewValue)) throw new Error('preview must be 0 or 1.');
const outputRoot = resolve(projectRoot, args.output ?? 'release/steamworks/generated');
const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const contentRoot = vdfPath(relative(outputRoot, steamRoot));
const buildOutput = 'build-output';
const depotFilename = `depot_build_${depotId}.vdf`;
const appFilename = `app_build_${appId}.vdf`;

const depotVdf = `"DepotBuildConfig"
{
  "DepotID" "${depotId}"
  "ContentRoot" "${contentRoot}"
  "FileMapping"
  {
    "LocalPath" "*"
    "DepotPath" "."
    "recursive" "1"
  }
}
`;

const appVdf = `"appbuild"
{
  "appid" "${appId}"
  "desc" "Feitu World ${packageJson.version} Windows x64"
  "buildoutput" "${buildOutput}"
  "contentroot" "${contentRoot}"
  "setlive" "${branch}"
  "preview" "${previewValue}"
  "depots"
  {
    "${depotId}" "${depotFilename}"
  }
}
`;

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, depotFilename), depotVdf, 'utf8');
await writeFile(join(outputRoot, appFilename), appVdf, 'utf8');

console.log(JSON.stringify({
  status: 'PASS',
  version: packageJson.version,
  appId,
  depotId,
  branch,
  preview: previewValue === '1',
  credentialsStored: false,
  appVdf: relative(projectRoot, join(outputRoot, appFilename)),
  depotVdf: relative(projectRoot, join(outputRoot, depotFilename))
}, null, 2));
