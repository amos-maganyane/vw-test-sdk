import { describe, it, expect } from 'vitest';
import { checkEvalSafety } from '../src/evalGuards.js';

describe('checkEvalSafety — destructive image ops (carry-forward #49)', () => {
  it('refuses bare ObjectMemory snapshot', () => {
    const r = checkEvalSafety('ObjectMemory snapshot');
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-snapshot');
  });

  it('refuses keyword snapshotAs: with an argument', () => {
    const r = checkEvalSafety("ObjectMemory snapshotAs: 'c:\\img.im' asFilename");
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-snapshot');
  });

  it('refuses SmalltalkImage current snapshotThenQuit', () => {
    expect(checkEvalSafety('SmalltalkImage current snapshotThenQuit').safe).toBe(false);
  });

  it('refuses the indirect (Smalltalk at: #ObjectMemory) snapshot form', () => {
    const r = checkEvalSafety('(Smalltalk at: #ObjectMemory) snapshot');
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-snapshot');
  });

  it('accepts read-only ObjectMemory sends', () => {
    expect(checkEvalSafety('ObjectMemory compactingGC').safe).toBe(true);
    expect(checkEvalSafety('ObjectMemory imageName').safe).toBe(true);
  });
});

describe('checkEvalSafety — relocate (carry-forward #51)', () => {
  it('refuses relocateObject: send', () => {
    const r = checkEvalSafety('dest relocateObject: cls from: src');
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-relocate');
  });

  it('accepts a #relocateObject:from: symbol literal', () => {
    expect(checkEvalSafety('#relocateObject:from: printString').safe).toBe(true);
  });
});

describe('checkEvalSafety — Bug #5 substring', () => {
  it('refuses a body containing both VWBridge and dispatch', () => {
    const r = checkEvalSafety('VWB.VWBridge singleton dispatch: aRequest');
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-bug5');
  });

  it('accepts VWBridge without dispatch', () => {
    expect(checkEvalSafety('VWB.VWBridge singleton handleWindows').safe).toBe(true);
  });
});

describe('checkEvalSafety — compile on VWB.*', () => {
  it('refuses compile: on a VWB class', () => {
    const r = checkEvalSafety("VWB.VWBridge compile: 'foo ^1' classified: 'x'");
    expect(r.safe).toBe(false);
    expect(r.outcome).toBe('refused-vwb-compile');
  });

  it('accepts compile: on a non-VWB class', () => {
    expect(checkEvalSafety("Customer compile: 'foo ^1' classified: 'x'").safe).toBe(true);
  });
});

describe('checkEvalSafety — benign code', () => {
  it('accepts ordinary expressions', () => {
    expect(checkEvalSafety('1 + 2').safe).toBe(true);
    expect(checkEvalSafety("Customer new name: 'Test'; yourself").safe).toBe(true);
  });
});
