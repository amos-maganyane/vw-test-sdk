import { describe, it, expect } from 'vitest';
import { VWReporter } from '../src/reporter.js';
import type { TestCase, TestResult } from '@playwright/test/reporter';

const tc = {} as unknown as TestCase;
const result = (status: TestResult['status']): TestResult => ({ status }) as unknown as TestResult;

describe('VWReporter', () => {
  it('tallies passed / failed / skipped from onTestEnd', () => {
    const reporter = new VWReporter();
    reporter.onTestEnd(tc, result('passed'));
    reporter.onTestEnd(tc, result('passed'));
    reporter.onTestEnd(tc, result('failed'));
    reporter.onTestEnd(tc, result('timedOut'));
    reporter.onTestEnd(tc, result('skipped'));

    expect(reporter.getSummary()).toEqual({
      total: 5,
      passed: 2,
      failed: 2,
      flaky: 0,
      skipped: 1,
    });
  });

  it('returns a copy of the summary', () => {
    const reporter = new VWReporter();
    const a = reporter.getSummary();
    a.total = 99;
    expect(reporter.getSummary().total).toBe(0);
  });
});
