import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const verifyScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
try {
  Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
  Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1" -ErrorAction Stop
  $signature = Get-AuthenticodeSignature -LiteralPath $env:FEITU_SIGNATURE_PATH -ErrorAction Stop
  [pscustomobject]@{
    status = $signature.Status.ToString()
    hasSignerCertificate = ($null -ne $signature.SignerCertificate)
  } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

export function isValidAuthenticodeResult(result) {
  const statuses = ['Valid', 'NotSigned', 'HashMismatch', 'NotTrusted', 'NotSupportedFileFormat', 'Incompatible'];
  if (!result || !statuses.includes(result.status) || typeof result.hasSignerCertificate !== 'boolean') {
    throw new Error('Authenticode verification did not return a conclusive signature status.');
  }
  return result.status === 'Valid' && result.hasSignerCertificate;
}

export async function hasAuthenticodeSignature(path) {
  if (process.platform !== 'win32') throw new Error('Authenticode verification requires Windows.');
  // Keep paths out of PowerShell source so quotes, backticks and $() remain literal.
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!windowsRoot) throw new Error('Cannot locate Windows PowerShell without SystemRoot or WINDIR.');
  const powershell = join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execFileAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', verifyScript], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
    env: { ...process.env, FEITU_SIGNATURE_PATH: resolve(path) }
  });
  return isValidAuthenticodeResult(JSON.parse(stdout.replace(/^\uFEFF/, '').trim()));
}
