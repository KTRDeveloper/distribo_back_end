// Dependency audit gate: fails on any high or critical advisory except the ones waived below.
// Each waiver is an ADR decision; remove the entry when the ADR is superseded.
import { spawnSync } from 'node:child_process';

const WAIVED = new Map([
  ['GHSA-mrhx-c7xc-m3w5', 'ADR-007: zod 3.x has no fix; migration to zod 4 is a separate project'],
]);
const FAILING = new Set(['high', 'critical']);

const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error('audit: npm audit returned no readable JSON (registry unreachable?)');
  process.exit(2);
}
if (report.error) {
  console.error(`audit: ${report.error.summary ?? 'npm audit failed'}`);
  process.exit(2);
}

const vulnerabilities = report.vulnerabilities ?? {};

/** Advisory IDs behind a package, following "via" links to other packages. */
function advisoriesOf(name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const ids = [];
  for (const via of vulnerabilities[name]?.via ?? []) {
    if (typeof via === 'string') ids.push(...advisoriesOf(via, seen));
    else ids.push(via.url?.split('/').pop() ?? `source-${via.source}`);
  }
  return ids;
}

const blocking = [];
for (const [name, vuln] of Object.entries(vulnerabilities)) {
  if (!FAILING.has(vuln.severity)) continue;
  const ids = advisoriesOf(name);
  const open = ids.filter((id) => !WAIVED.has(id));
  if (ids.length === 0 || open.length > 0) blocking.push(`${name} (${vuln.severity}): ${open.join(', ') || 'unknown advisory'}`);
  else console.log(`audit: ${name} (${vuln.severity}) waived: ${[...new Set(ids)].map((id) => `${id} - ${WAIVED.get(id)}`).join('; ')}`);
}

if (blocking.length > 0) {
  console.error('audit: unwaived high or critical vulnerabilities:');
  for (const line of blocking) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('audit: no unwaived high or critical vulnerability');
