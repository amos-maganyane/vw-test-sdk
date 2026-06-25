/**
 * clientFromEnv.ts — build a VWTestClient from environment configuration.
 *
 * Env precedence (architecture §9.5):
 *   VW_BRIDGE_URL          → bridgeUrl
 *   VW_BRIDGE_TOKEN_FILE   → tokenFile        (path)
 *   VW_BRIDGE_TOKEN        → literal token    (handled inside VWTestClient)
 * Explicit `overrides` always win over env.
 */

import { VWTestClient, type VWClientOptions } from '@enviro365/vw-test-sdk-core';

export function clientOptionsFromEnv(overrides: VWClientOptions = {}): VWClientOptions {
  const opts: VWClientOptions = { ...overrides };

  const url = process.env['VW_BRIDGE_URL'];
  if (url !== undefined && opts.bridgeUrl === undefined) {
    opts.bridgeUrl = url;
  }
  const tokenFile = process.env['VW_BRIDGE_TOKEN_FILE'];
  if (tokenFile !== undefined && opts.tokenFile === undefined) {
    opts.tokenFile = tokenFile;
  }
  return opts;
}

export function createClientFromEnv(overrides: VWClientOptions = {}): VWTestClient {
  return new VWTestClient(clientOptionsFromEnv(overrides));
}
