import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  startVideoRecording,
  resolveFfmpegPath,
  buildVideoEncodeArgs,
  type VideoRecorder,
  type RecordedVideo,
} from '../src/video.js';
import type { AttachableTestInfo } from '../src/evidence.js';
import type { VWTestClient } from '@enviro365/vw-test-sdk-core';

const WINDOW = { title: 'storedev64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' };

function makeBgraFrame(width = 64, height = 64): {
  bytes: Uint8Array;
  width: number;
  height: number;
  pixelFormat: string;
} {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = 30; // B
    bytes[i + 1] = 30; // G
    bytes[i + 2] = 200; // R
    bytes[i + 3] = 255; // A
  }
  return { bytes, width, height, pixelFormat: 'bgra' };
}

function makeVw(overrides: Partial<Record<string, unknown>> = {}): VWTestClient {
  return {
    render: vi.fn(async (_opts?: unknown) => makeBgraFrame()),
    listWindows: vi.fn(async () => [WINDOW]),
    getActionLog: vi.fn(() => []),
    ...overrides,
  } as unknown as VWTestClient;
}

function makeAttachSpy(): Mock<[name: string, options?: unknown], Promise<void>> {
  return vi.fn(async (_name: string, _options?: unknown) => {});
}

async function waitForFrames(recorder: VideoRecorder, min: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (recorder.frameCount < min && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(recorder.frameCount).toBeGreaterThanOrEqual(min);
}

describe('startVideoRecording', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is off unless VW_VIDEO is truthy — no capture, no overhead', () => {
    delete process.env['VW_VIDEO'];
    const vw = makeVw();
    expect(startVideoRecording(vw)).toBeUndefined();
    expect(vw.render).not.toHaveBeenCalled();

    vi.stubEnv('VW_VIDEO', '0');
    expect(startVideoRecording(vw)).toBeUndefined();
    expect(vw.render).not.toHaveBeenCalled();
  });

  it('captures in-image /render frames at VW_VIDEO_FPS and stops deterministically', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw();
    const recorder = startVideoRecording(vw);
    expect(recorder).toBeDefined();
    expect(recorder?.fps).toBe(10);

    await waitForFrames(recorder!, 3);
    const recording = await recorder!.stop();
    expect(recording.frameCount).toBeGreaterThanOrEqual(3);
    expect(recording.framePaths).toHaveLength(recording.frameCount);
    for (const framePath of recording.framePaths) expect(existsSync(framePath)).toBe(true);

    expect(vw.render).toHaveBeenCalledWith({
      timeoutMs: 15_000,
      recordAction: false,
      windowTitle: WINDOW.title,
      appClass: WINDOW.appClass,
    });

    const frozen = recording.frameCount;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(recorder!.frameCount).toBe(frozen);
    await expect(recorder!.stop()).resolves.toBe(recording);

    await recording.discard();
    expect(existsSync(dirname(recording.framePaths[0]))).toBe(false);
  });

  it('tops up to the video minimum when a short test stops before frame 1 resolves', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '1');
    const vw = makeVw({
      render: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return makeBgraFrame();
      }),
    });

    const recorder = startVideoRecording(vw)!;
    // The test body ends long before the first slow capture resolves.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const recording = await recorder.stop();

    expect(recording.frameCount).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(vw.render).mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const framePath of recording.framePaths) expect(existsSync(framePath)).toBe(true);
    await recording.discard();
  });

  it('clamps an invalid VW_VIDEO_FPS to the 1 fps default', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', 'banana');
    const recorder = startVideoRecording(makeVw());
    expect(recorder?.fps).toBe(1);
    const recording = await recorder?.stop();
    await recording?.discard();
  });

  it('degrades to the raw-frame fallback when ffmpeg cannot be spawned', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    vi.stubEnv('VW_FFMPEG_PATH', join(tmpdir(), 'definitely-not-ffmpeg.exe'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const recorder = startVideoRecording(makeVw())!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();
    const attach = makeAttachSpy();

    await recording.attach({ attach } as unknown as AttachableTestInfo);

    const names = attach.mock.calls.map((call) => call[0]);
    expect(names).not.toContain('video.mp4');
    expect(names).toContain('video-frames.json');
    expect(names.filter((name) => name.startsWith('video-frames/')).length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    expect(existsSync(dirname(recording.framePaths[0]))).toBe(false);
  });

  it('sustains capture errors without throwing and surfaces them as a warning', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      render: vi.fn(async () => {
        throw new Error('bridge down');
      }),
    });
    const recorder = startVideoRecording(vw)!;
    await new Promise((resolve) => setTimeout(resolve, 250));

    const recording = await recorder.stop();
    expect(recording.frameCount).toBe(0);
    expect(recording.warning).toContain('bridge down');
    await recording.discard();
  });

  it('attaches zero frames as a clearly named fallback without failing', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    vi.stubEnv('VW_FFMPEG_PATH', join(tmpdir(), 'definitely-not-ffmpeg.exe'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const recorder = startVideoRecording(
      makeVw({
        render: vi.fn(async () => {
          throw new Error('no bridge');
        }),
      })
    )!;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const recording = await recorder.stop();
    const attach = makeAttachSpy();

    await recording.attach({ attach } as unknown as AttachableTestInfo);

    expect(attach.mock.calls.map((call) => call[0])).toContain('video-frames.json');
    const framesJson = attach.mock.calls.find((call) => call[0] === 'video-frames.json')?.[1] as
      | { body?: string }
      | undefined;
    expect(framesJson?.body ?? '').toContain('last capture error: no bridge');
  });
});

const FFMPEG_AVAILABLE = (await resolveFfmpegPath()) !== undefined;

describe('dynamic target resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const APP_WINDOW = { title: 'Sub-instructions Review', appClass: 'MCPBenchReviewWindow' };
  const TOOL_WINDOW = { title: 'storeTst64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' };

  it('films the window named by the most recent interactive action, not the first window', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW, APP_WINDOW]),
      getActionLog: vi.fn(() => [
        { ts: 1, kind: 'click', detail: { aspect: 'btnSearch', windowTitle: APP_WINDOW.title }, ok: true },
      ]),
    });

    const recorder = startVideoRecording(vw)!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: APP_WINDOW.title, appClass: APP_WINDOW.appClass })
    );
    await recording.discard();
  });

  it('picks up a window that appears AFTER the recorder starts', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    let appOpen = false;
    const vw = makeVw({
      listWindows: vi.fn(async () => (appOpen ? [TOOL_WINDOW, APP_WINDOW] : [TOOL_WINDOW])),
      getActionLog: vi.fn(() =>
        appOpen
          ? [{ ts: 2, kind: 'click', detail: { aspect: 'btnSearch', windowTitle: APP_WINDOW.title }, ok: true }]
          : []
      ),
    });

    const recorder = startVideoRecording(vw)!;
    await waitForFrames(recorder, 1);
    appOpen = true;
    await waitForFrames(recorder, 3);
    const recording = await recorder.stop();

    const calls = vi.mocked(vw.render).mock.calls.map((call) => call[0] as { windowTitle?: string });
    expect(calls.some((opts) => opts.windowTitle === APP_WINDOW.title)).toBe(true);
    await recording.discard();
  });

  it('lets an explicit windowTitle override the action log', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW, APP_WINDOW]),
      getActionLog: vi.fn(() => [
        { ts: 1, kind: 'click', detail: { windowTitle: APP_WINDOW.title }, ok: true },
      ]),
    });

    const recorder = startVideoRecording(vw, { windowTitle: TOOL_WINDOW.title })!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: TOOL_WINDOW.title })
    );
    await recording.discard();
  });

  it('defers without throwing when no window exists yet, then warns clearly if none ever appears', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vw = makeVw({
      listWindows: vi.fn(async () => []),
      getActionLog: vi.fn(() => []),
    });

    const recorder = startVideoRecording(vw)!;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const recording = await recorder.stop();

    expect(recording.frameCount).toBe(0);
    expect(recording.warning).toContain('no frames captured');
    expect(recording.warning).toContain('never opened a window');
    expect(vw.render).not.toHaveBeenCalled();

    const attach = makeAttachSpy();
    await recording.attach({ attach } as unknown as AttachableTestInfo);
    expect(attach.mock.calls.map((call) => call[0])).toContain('video-frames.json');
    expect(warn).toHaveBeenCalled();
  });

  it('ignores render/screenshot actions when choosing the target', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW, APP_WINDOW]),
      getActionLog: vi.fn(() => [
        { ts: 1, kind: 'click', detail: { windowTitle: APP_WINDOW.title }, ok: true },
        { ts: 2, kind: 'render', detail: { window: TOOL_WINDOW.title }, ok: true },
        { ts: 3, kind: 'screenshot', detail: { window: TOOL_WINDOW.title }, ok: true },
      ]),
    });

    const recorder = startVideoRecording(vw)!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: APP_WINDOW.title })
    );
    await recording.discard();
  });
});

describe('video assembly', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('builds encode args with even-dimension padding and h264', () => {
    const args = buildVideoEncodeArgs('frame-%04d.png', 'out.mp4', 2);
    expect(args).toContain('libx264');
    expect(args).toContain('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(args[args.indexOf('-framerate') + 1]).toBe('2.000');
  });

  it.skipIf(!FFMPEG_AVAILABLE)('encodes an mp4 with a real ffmpeg binary and attaches it', async () => {
      vi.stubEnv('VW_VIDEO', '1');
      vi.stubEnv('VW_VIDEO_FPS', '10');
      const recorder = startVideoRecording(makeVw())!;
      await waitForFrames(recorder, 3);
      const recording: RecordedVideo = await recorder.stop();

      const checks: Array<{ exists: boolean; size: number }> = [];
      const attach = vi.fn(async (name: string, options?: unknown) => {
        if (name !== 'video.mp4') return;
        const videoPath = (options as { path: string }).path;
        checks.push({ exists: existsSync(videoPath), size: existsSync(videoPath) ? statSync(videoPath).size : 0 });
      });

      await recording.attach({ attach } as unknown as AttachableTestInfo);

      const names = attach.mock.calls.map((call) => call[0]);
      expect(names).toContain('video.mp4');
      expect(names).not.toContain('video-frames.json');
      expect(checks).toHaveLength(1);
      expect(checks[0].exists).toBe(true);
      expect(checks[0].size).toBeGreaterThan(0);
  });
});


