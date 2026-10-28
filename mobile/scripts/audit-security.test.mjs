import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inspectAudit, runAudits } from './audit-security.mjs';

function fixture(file = 'audit-full.json') {
  return JSON.parse(
    readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8'),
  );
}
const result = (report) => ({ status: 1, stdout: JSON.stringify(report) });

test('accepts only the known advisories, including propagated dependencies in both trees', () => {
  for (const file of ['audit-full.json', 'audit-production.json']) {
    const findings = inspectAudit(result(fixture(file)));
    assert.equal(findings.accepted.length, 2);
    assert.deepEqual(findings.unexpected, []);
  }
});

for (const severity of ['low', 'moderate', 'high', 'critical']) {
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

test('runs both exact audit commands even when the full-tree audit finds an advisory', () => {
  const calls = [];
  const messages = [];
  assert.throws(
    () =>
      runAudits(
        (command, args, options) => {
          calls.push([command, args]);
          assert.equal(options.timeout, 120_000);
          const report = fixture();
          if (calls.length === 1) {
            report.vulnerabilities.deepmerge = {
              name: 'deepmerge',
              severity: 'low',
              via: [
                {
                  name: 'deepmerge',
                  dependency: 'deepmerge',
                  severity: 'low',
                  url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
                  range: '>=4.2.0 <=4.3.1',
                  title: 'Synthetic low severity advisory',
                },
              ],
              effects: [],
              range: '>=4.2.0',
              nodes: ['node_modules/deepmerge'],
              fixAvailable: {
                name: 'expo',
                version: '51.0.39',
                isSemVerMajor: true,
              },
            };
            report.metadata.vulnerabilities.low++;
            report.metadata.vulnerabilities.total++;
            return result(report);
          }
          return { status: null, signal: 'SIGTERM' };
        },
        (message) => messages.push(message),
      ),
    /Production tree: Audit execution failed/,
  );
  assert.deepEqual(calls, [
    ['npm', ['audit', '--json']],
    ['npm', ['audit', '--omit=dev', '--json']],
  ]);
  assert.ok(
    messages.some((message) =>
      message.includes(
        'deepmerge: GHSA-xxxx-yyyy-zzzz | low | affected >=4.2.0 <=4.3.1',
      ),
    ),
  );
  assert.ok(messages.some((message) => message.startsWith('Production tree:')));
});

test('reports advisory scope and rejects an unrelated major-version suggestion as a fix', () => {
  const report = fixture();
  report.vulnerabilities.deepmerge = {
    name: 'deepmerge',
    severity: 'low',
    via: [
      {
        name: 'deepmerge',
        dependency: 'deepmerge',
        severity: 'low',
        url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
        range: '>=4.2.0 <=4.3.1',
        title: 'Synthetic low severity advisory',
      },
    ],
    effects: [],
    range: '>=4.2.0',
    nodes: ['node_modules/deepmerge'],
    fixAvailable: {
      name: 'expo',
      version: '51.0.39',
      isSemVerMajor: true,
    },
  };
  report.metadata.vulnerabilities.low++;
  report.metadata.vulnerabilities.total++;

  const [finding] = inspectAudit(result(report)).unexpected;
  assert.deepEqual(finding, {
    package: 'deepmerge',
    advisory: 'GHSA-xxxx-yyyy-zzzz',
    severity: 'low',
    affectedRange: '>=4.2.0 <=4.3.1',
    title: 'Synthetic low severity advisory',
    remediation:
      'npm proposes expo@51.0.39 (major version change; check compatibility), which does not replace deepmerge.',
  });
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
