/**
 * smalltalk.ts — tiny Smalltalk-emission helpers.
 *
 * The SDK emits a little Smalltalk for the eval escape hatches and for
 * cleanup. These keep quoting + identifier sanitization in one place.
 */

/**
 * Wrap a string as a Smalltalk string literal, doubling embedded single quotes.
 * `it's` → `'it''s'`.
 */
export function quoteSmalltalkString(body: string): string {
  return `'${body.replace(/'/g, "''")}'`;
}

/**
 * Sanitize a Playwright test title into the `TestName` segment of the
 * `TestSDK_<TestName>_<worker>_<ts>` artifact-naming convention (architecture
 * §15.1): alphanumeric + underscore, collapsed runs, trimmed, max 40 chars.
 */
export function sanitizeTestName(title: string): string {
  return title
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Build the `TestSDK_<TestName>_<worker>_<ts>` class/artifact prefix
 * (architecture §15.1). `unixTimestamp` defaults to now (seconds).
 */
export function testArtifactPrefix(
  testName: string,
  workerIndex: number,
  unixTimestamp: number = Math.floor(Date.now() / 1000)
): string {
  return `TestSDK_${sanitizeTestName(testName)}_${workerIndex}_${unixTimestamp}`;
}
