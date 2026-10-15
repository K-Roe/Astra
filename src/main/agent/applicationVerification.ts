import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWithinRootNotRoot } from '../workspace/pathGuard';

/** Check observable React/Vite readiness before any completion claim. */
export function verifyReactApplication(root: string, manifest: readonly string[]): { issues: string[]; dependenciesAvailable: boolean } {
  const issues: string[] = [];
  const safeFiles = new Set<string>();
  for (const relative of manifest) {
    const target = path.join(root, relative);
    try {
      resolveWithinRootNotRoot(target, { root });
      if (!existsSync(target) || !lstatSync(target).isFile() || lstatSync(target).size === 0) issues.push(`${relative} is missing, empty or a link`);
      else safeFiles.add(relative);
    } catch { issues.push(`${relative} is outside the real project directory or crosses a link`); }
  }
  const packagePath = path.join(root, 'package.json');
  if (safeFiles.has('package.json')) {
    try {
      const manifestJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      if (typeof manifestJson.scripts?.dev !== 'string' || !manifestJson.scripts.dev.includes('vite')) issues.push('package.json does not define a Vite npm run dev script');
      if (typeof manifestJson.scripts?.build !== 'string') issues.push('package.json does not define an npm build script');
      if (!manifestJson.dependencies?.react || !manifestJson.dependencies?.['react-dom'] || !manifestJson.devDependencies?.vite) issues.push('React/Vite dependencies are not declared');
    } catch { issues.push('package.json is not valid JSON'); }
  }
  const appFile = path.join(root, 'src', 'App.tsx');
  if (safeFiles.has('src/App.tsx') && !/\b(?:import|export|function|=>)\b/.test(readFileSync(appFile, 'utf8'))) issues.push('src/App.tsx has no application source');
  const dependenciesAvailable = existsSync(path.join(root, 'node_modules', 'vite')) && existsSync(path.join(root, 'node_modules', 'react'));
  if (!dependenciesAvailable) issues.push('dependencies are unavailable; installation needs separate approval and the build cannot run');
  return { issues, dependenciesAvailable };
}
