import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const exceptions = new Map([
  ['GHSA-vfj7-8cjw-p6xm', 'braces'],
  ['GHSA-86w9-cpqp-85rv', 'node-forge'],
  ['GHSA-rj75-hqrm-r3gf', 'postcss-selector-parser'],
]);
const temporaryExceptions = new Map([
  ['GHSA-gcqx-w48m-w2h4', { package: 'deepmerge', reviewBy: '2026-11-28' }],
]);
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function inspectAudit(result, { now = new Date() } = {}) {
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
  const unexpected = new Map();

  function remediationFor(name, fixAvailable) {
    if (!fixAvailable) return 'npm reports no available fix.';
    if (fixAvailable === true) {
      return 'npm reports a fix; review the package-specific version before updating.';
    }
    if (!isObject(fixAvailable)) {
      return 'npm returned an unsupported fix recommendation; review the audit report.';
    }

    const fixName = fixAvailable.name ?? name;
    const version = fixAvailable.version;
    const majorNote = fixAvailable.isSemVerMajor
      ? ' (major version change; check compatibility)'
      : '';
    const recommendation = version
      ? `${fixName}@${version}${majorNote}`
      : fixName;

    if (fixName !== name) {
      return `npm proposes ${recommendation}, which does not replace ${name}.`;
    }

    return `npm proposes ${recommendation}.`;
  }

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
        const temporaryException = temporaryExceptions.get(id);
        const exceptionPackage =
          exceptions.get(id) ?? temporaryException?.package;
        const expired =
          temporaryException !== undefined &&
          now.toISOString().slice(0, 10) > temporaryException.reviewBy;
        if (
          exceptionPackage === name &&
          via.name === name &&
          via.dependency === name
        ) {
          if (expired) {
            const finding = {
              package: name,
              advisory: id,
              severity: via.severity,
              affectedRange: via.range ?? entry.range,
              title: via.title,
              remediation: remediationFor(name, entry.fixAvailable),
              reason: `Temporary exception expired after ${temporaryException.reviewBy}.`,
            };
            unexpected.set(`${name}:${id}`, finding);
          } else {
            accepted.add(`${name}: ${id}`);
          }
        } else {
          const advisoryId = id ?? via.url;
          const finding = {
            package: name,
            advisory: advisoryId,
            severity: via.severity,
            affectedRange: via.range ?? entry.range,
            title: via.title,
            remediation: remediationFor(name, entry.fixAvailable),
          };
          unexpected.set(`${name}:${advisoryId}`, finding);
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
  return {
    accepted: [...accepted].sort(),
    unexpected: [...unexpected.values()].sort((left, right) =>
      `${left.package}:${left.advisory}`.localeCompare(
        `${right.package}:${right.advisory}`,
      ),
    ),
  };
}

export function runAudits(
  execute = spawnSync,
  log = console.log,
  { now = new Date() } = {},
) {
  const failures = [];
  const auditResults = [];

  for (const [label, args] of [
    ['Full tree', ['audit', '--json']],
    ['Production tree', ['audit', '--omit=dev', '--json']],
  ]) {
    try {
      const result = execute('npm', args, {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const findings = inspectAudit(result, { now });
      auditResults.push({ label, findings });
      log(
        `${label}: ${findings.accepted.length} accepted, ${findings.unexpected.length} unexpected advisories`,
      );
      for (const finding of findings.accepted) {
        log(`  Temporary exception: ${finding}`);
      }
      for (const finding of findings.unexpected) {
        const detail = [
          `${finding.package}: ${finding.advisory}`,
          finding.severity,
          `affected ${finding.affectedRange}`,
          finding.title,
          ...(finding.reason ? [finding.reason] : []),
          `Remediation: ${finding.remediation}`,
        ].join(' | ');
        log(`  Unexpected: ${detail}`);
        if (process.env.GITHUB_ACTIONS === 'true') {
          const annotation = detail
            .replaceAll('%', '%25')
            .replaceAll('\r', '%0D')
            .replaceAll('\n', '%0A')
            .replaceAll(':', '%3A')
            .replaceAll(',', '%2C');
          log(`::error title=Vulnerable dependency::${annotation}`);
        }
      }
      if (findings.unexpected.length) {
        failures.push(`${label}: unexpected vulnerabilities detected`);
      }
    } catch (error) {
      const failure = `${label}: ${error.message}`;
      failures.push(failure);
      auditResults.push({ label, error: failure });
      log(failure);
    }
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, formatAuditSummary(auditResults));
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

export function formatAuditSummary(auditResults) {
  const lines = [
    '## Mobile dependency security audit',
    '',
    '| Dependency tree | Unexpected advisory status | Accepted known advisories |',
    '| --- | --- | --- |',
  ];

  for (const auditResult of auditResults) {
    if (auditResult.error) {
      lines.push(
        `| ${auditResult.label} | Audit failed before policy evaluation | None |`,
      );
      continue;
    }

    const accepted = auditResult.findings.accepted.length
      ? auditResult.findings.accepted
          .map((entry) => {
            const [packageName, advisory] = entry.split(': ');
            const exception = temporaryExceptions.get(advisory);
            const reviewNote = exception
              ? ` (review by ${exception.reviewBy})`
              : ' (existing exception)';
            return `${packageName} ${advisory}${reviewNote}`;
          })
          .join('<br>')
      : 'None';
    const status = auditResult.findings.unexpected.length
      ? 'New or expired advisories require action'
      : 'No unexpected advisories';

    lines.push(`| ${auditResult.label} | ${status} | ${accepted} |`);
  }

  const unexpectedFindings = auditResults.flatMap(
    (auditResult) => auditResult.findings?.unexpected ?? [],
  );
  if (unexpectedFindings.length) {
    lines.push('', '### New or expired advisories requiring action', '');
    for (const finding of unexpectedFindings) {
      lines.push(
        `- **${finding.package} — ${finding.advisory} (${finding.severity})**: ` +
          `${finding.title}. ${finding.reason ?? finding.remediation}`,
      );
    }
  }

  const auditErrors = auditResults.filter((auditResult) => auditResult.error);
  if (auditErrors.length) {
    lines.push('', '### Audit execution errors', '');
    for (const auditError of auditErrors) {
      lines.push(`- ${auditError.error}`);
    }
  }

  lines.push('');
  return lines.join('\n');
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
