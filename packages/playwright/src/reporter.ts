/**
 * reporter.ts — a minimal Playwright reporter that summarizes the run and the
 * VW image it ran against (architecture §8.3). Bridge call-metric aggregation
 * (p50/p99 latency) is a future enhancement; this scaffolds the integration.
 */

import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export class VWReporter implements Reporter {
  private readonly summary: RunSummary = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 };

  onTestEnd(_test: TestCase, result: TestResult): void {
    this.summary.total += 1;
    switch (result.status) {
      case 'passed':
        this.summary.passed += 1;
        break;
      case 'failed':
      case 'timedOut':
      case 'interrupted':
        this.summary.failed += 1;
        break;
      case 'skipped':
        this.summary.skipped += 1;
        break;
    }
  }

  onEnd(result: FullResult): void {
    const s = this.summary;
    // eslint-disable-next-line no-console
    console.log(
      `[vw-test-sdk] run ${result.status}: ${s.passed}/${s.total} passed` +
        (s.failed > 0 ? `, ${s.failed} failed` : '') +
        (s.skipped > 0 ? `, ${s.skipped} skipped` : '')
    );
  }

  /** Current tally (exposed for testing). */
  getSummary(): RunSummary {
    return { ...this.summary };
  }
}

export default VWReporter;
