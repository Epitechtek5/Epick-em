import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectAudit, runAudits } from './audit-security.mjs';

function fixture(file = 'npm-audit.json') {
  return JSON.parse(
    readFileSync(new URL(`../docs/evidence/${file}`, import.meta.url), 'utf8'),
  );
}
const result = (report) => ({ status: 1, stdout: JSON.stringify(report) });

test('accepts only the known advisories, including propagated dependencies in both trees', () => {
  for (const file of ['npm-audit.json', 'npm-audit-production.json']) {
    const findings = inspectAudit(result(fixture(file)));
    assert.equal(findings.accepted.length, 2);
    assert.deepEqual(findings.unexpected, []);
  }
});

for (const severity of ['moderate', 'high', 'critical']) {
  test(`rejects a new ${severity} advisory on an allowed package`, () => {
    const report = fixture();
    report.vulnerabilities.braces.via.push({
      ...report.vulnerabilities.braces.via[0],
      severity,
      url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
    });
    assert.equal(inspectAudit(result(report)).unexpected.length, 1);
    assert.throws(
      () =>
        runAudits(
          () => result(report),
          () => {},
        ),
      /unexpected vulnerabilities/,
    );
  });
}

test('rejects a known GHSA attached to the wrong package', () => {
  const report = fixture();
  report.vulnerabilities.braces.via[0] = {
    ...report.vulnerabilities['node-forge'].via[0],
    name: 'braces',
    dependency: 'braces',
  };
  assert.equal(inspectAudit(result(report)).unexpected.length, 1);
});

test('rejects a new vulnerable package', () => {
  const report = fixture();
  report.vulnerabilities.other = {
    name: 'other',
    severity: 'moderate',
    via: [
      {
        name: 'other',
        dependency: 'other',
        severity: 'moderate',
        url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
      },
    ],
  };
  report.metadata.vulnerabilities.moderate++;
  report.metadata.vulnerabilities.total++;
  assert.equal(inspectAudit(result(report)).unexpected.length, 1);
});

test('rejects malformed JSON, error reports and incomplete reports', () => {
  for (const stdout of [
    '',
    'not json',
    'null',
    '{}',
    '{"error":{"code":"ENOAUDIT"}}',
  ]) {
    assert.throws(() => inspectAudit({ status: 1, stdout }));
  }
  const report = fixture();
  delete report.vulnerabilities.braces;
  assert.throws(() => inspectAudit(result(report)));
  const missingLink = fixture();
  missingLink.vulnerabilities.braces.via = ['missing'];
  assert.throws(
    () => inspectAudit(result(missingLink)),
    /Missing audit dependency/,
  );
});

test('rejects spawn failures, timeouts, signals and unexpected exit codes', () => {
  for (const failure of [
    { status: 2 },
    { status: null },
    { status: 1, signal: 'SIGTERM' },
    { status: 1, error: new Error('ETIMEDOUT') },
    { status: 1, error: new Error('ENOENT') },
  ]) {
    assert.throws(
      () => inspectAudit({ ...result(fixture()), ...failure }),
      /execution failed/,
    );
  }
  assert.throws(
    () =>
      runAudits(() => {
        throw new Error('spawn failed');
      }),
    /spawn failed/,
  );
});

test('runs both exact audit commands and fails if the production audit cannot complete', () => {
  const calls = [];
  assert.throws(
    () =>
      runAudits(
        (command, args, options) => {
          calls.push([command, args]);
          assert.equal(options.timeout, 120_000);
          return calls.length === 1
            ? result(fixture())
            : { status: null, signal: 'SIGTERM' };
        },
        () => {},
      ),
    /execution failed/,
  );
  assert.deepEqual(calls, [
    ['npm', ['audit', '--json']],
    ['npm', ['audit', '--omit=dev', '--json']],
  ]);
});

test('accepts a complete clean report and rejects inconsistent status', () => {
  const report = fixture();
  report.vulnerabilities = {};
  report.metadata.vulnerabilities = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: 0,
  };
  assert.deepEqual(
    inspectAudit({ status: 0, stdout: JSON.stringify(report) }),
    { accepted: [], unexpected: [] },
  );
  assert.throws(() => inspectAudit(result(report)), /exit status/);
});
