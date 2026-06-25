import { createClientFromEnv } from '@enviro365/vw-test-sdk-playwright';

/**
 * Global setup — verify the bridge is up at a compatible version (>= 0.11.0)
 * and warm the connection before any spec runs. Fails the whole run fast with
 * an actionable message if the bridge is missing or too old.
 */
async function globalSetup(): Promise<void> {
  const vw = createClientFromEnv();
  await vw.verifyBridge();
}

export default globalSetup;
