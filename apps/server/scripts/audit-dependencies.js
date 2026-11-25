import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.error || ![0, 1].includes(result.status)) {
  throw new Error(`npm audit did not complete: ${result.error?.message || result.stderr}`);
}
const report = JSON.parse(result.stdout);
if (report.error || !report.metadata?.vulnerabilities) throw new Error('npm audit returned an invalid report');
const exceptions = JSON.parse(await readFile(new URL('../../../docs/dependency-audit-exceptions.json', import.meta.url), 'utf8'));
const allowed = new Map(exceptions.map(entry => [`${entry.package}:${entry.advisory}`, entry]));
const observed = new Set();
const failures = [];
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const advisory of vulnerability.via.filter(item => typeof item === 'object')) {
    const id = advisory.url?.split('/').at(-1);
    const key = `${advisory.name}:${id}`;
    const exception = allowed.get(key);
    if (!exception || Date.now() >= Date.parse(`${exception.expires}T00:00:00Z`)) {
      failures.push(`${advisory.name}: ${id} (${advisory.severity})`);
    } else observed.add(key);
  }
}
if (failures.length) throw new Error(`Unreviewed or expired dependency advisories:\n${[...new Set(failures)].join('\n')}`);
for (const key of observed) console.log(`Known unresolved advisory: ${key}; see docs/dependency-audit.md`);
console.log(`Dependency audit: ${observed.size} reviewed unresolved advisory; no unreviewed advisories.`);
