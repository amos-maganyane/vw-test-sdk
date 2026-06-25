import { describe, it, expect, vi } from 'vitest';
import { VWTestClient } from '../src/client.js';
import { VWPage } from '../src/page.js';
import { makeStubBridge } from './_stub.js';

class CustomerPage extends VWPage {
  constructor(vw: VWTestClient) {
    super(vw, 'Customer Window');
  }
  searchField() {
    return this.window().field('searchText');
  }
}

describe('VWPage', () => {
  it('waitForOpen waits on windowExists for the page title', async () => {
    const bridge = makeStubBridge();
    const page = new CustomerPage(new VWTestClient({}, bridge));
    await page.waitForOpen(5000);
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/wait', {
      predicate: 'windowExists',
      timeoutMs: 5000,
      windowTitle: 'Customer Window',
    });
  });

  it('exposes a window-scoped field through the subclass', async () => {
    const bridge = makeStubBridge();
    const page = new CustomerPage(new VWTestClient({}, bridge));
    await page.searchField().fill('Test');
    expect(vi.mocked(bridge.postJson)).toHaveBeenCalledWith('/type', {
      aspect: 'searchText',
      value: 'Test',
      windowTitle: 'Customer Window',
    });
  });

  it('close closes the page window via eval', async () => {
    const bridge = makeStubBridge();
    const page = new CustomerPage(new VWTestClient({}, bridge));
    await page.close();
    expect(vi.mocked(bridge.postEval)).toHaveBeenCalled();
  });
});
