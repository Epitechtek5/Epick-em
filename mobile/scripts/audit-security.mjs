import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const exceptions = new Map([
  ['GHSA-vfj7-8cjw-p6xm', 'braces'],
  ['GHSA-86w9-cpqp-85rv', 'node-forge'],
  ['GHSA-rj75-hqrm-r3gf', 'postcss-selector-parser'],
]);
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function inspectAudit(result) {
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(
      `Audit execution failed: ${result.error?.message || result.signal || `exit ${result.status}`}`,
    );
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error('Audit returned invalid JSON');
  }
  if (
    !isObject(report) ||
    report.error ||
    report.auditReportVersion !== 2 ||
    !isObject(report.vulnerabilities) ||
    !isObject(report.metadata?.vulnerabilities)
  ) {
    throw new Error('Audit returned an incomplete or unsupported report');
  }
  const entries = report.vulnerabilities;
  const counts = Object.fromEntries(
    severities.map((severity) => [severity, 0]),
  );
  const accepted = new Set();
  const unexpected = new Set();

  function visit(name, path = new Set()) {
    const entry = entries[name];
    if (!entry) throw new Error(`Missing audit dependency: ${name}`);
    if (path.has(name)) return false;
    const next = new Set([...path, name]);
    let resolved = false;
    for (const via of entry.via) {
      if (typeof via === 'string') {
        resolved = visit(via, next) || resolved;
      } else {
        resolved = true;
        const match =
          /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(
            via.url,
          );
        const id = match?.[1];
        if (
          exceptions.get(id) === name &&
          via.name === name &&
          via.dependency === name
        ) {
          accepted.add(`${name}: ${id}`);
        } else {
          unexpected.add(`${name}: ${via.url} (${via.severity})`);
        }
      }
    }
    return resolved;
  }

  for (const [name, entry] of Object.entries(entries)) {
    if (
      !isObject(entry) ||
      entry.name !== name ||
      !severities.includes(entry.severity) ||
      !Array.isArray(entry.via) ||
      entry.via.length === 0
    ) {
      throw new Error(`Invalid audit entry: ${name}`);
    }
    counts[entry.severity]++;
    for (const via of entry.via) {
      if (typeof via === 'string') continue;
      if (
        !isObject(via) ||
        typeof via.url !== 'string' ||
        typeof via.name !== 'string' ||
        typeof via.dependency !== 'string' ||
        !severities.includes(via.severity)
      ) {
        throw new Error(`Invalid advisory for ${name}`);
      }
    }
  }
  for (const severity of severities) {
    if (report.metadata.vulnerabilities[severity] !== counts[severity]) {
      throw new Error(`Incomplete audit counts: ${severity}`);
    }
  }
  if (
    report.metadata.vulnerabilities.total !== Object.keys(entries).length ||
    (result.status === 0 && Object.keys(entries).length > 0) ||
    (result.status === 1 && Object.keys(entries).length === 0)
  ) {
    throw new Error('Audit exit status or total does not match the report');
  }
  for (const [name, entry] of Object.entries(entries)) {
    // Also inspect low-severity entries so a new advisory cannot hide on an allowed package.
    if (!visit(name) && severities.indexOf(entry.severity) >= 2) {
      throw new Error(`Unresolved advisory chain: ${name}`);
    }
  }
  return { accepted: [...accepted].sort(), unexpected: [...unexpected].sort() };
}

export function runAudits(execute = spawnSync, log = console.log) {
  for (const [label, args] of [
    ['Full tree', ['audit', '--json']],
    ['Production tree', ['audit', '--omit=dev', '--json']],
  ]) {
    const result = execute('npm', args, {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const findings = inspectAudit(result);
    log(
      `${label}: ${findings.accepted.length} accepted, ${findings.unexpected.length} unexpected advisories`,
    );
    for (const finding of findings.accepted)
      log(`  Temporary exception: ${finding}`);
    for (const finding of findings.unexpected) log(`  Unexpected: ${finding}`);
    if (findings.unexpected.length)
      throw new Error(`${label}: unexpected vulnerabilities detected`);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runAudits();
  } catch (error) {
    console.error(`Security audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
