import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  startVideoRecording,
  resolveFfmpegPath,
  buildVideoEncodeArgs,
  type VideoRecorder,
  type RecordedVideo,
} from '../src/video.js';
import { buildConcatFile, computeFrameDurations } from '../src/frameTimeline.js';
import type { AttachableTestInfo } from '../src/evidence.js';
import type { VWTestClient } from '@enviro365/vw-test-sdk-core';

const WINDOW = { title: 'MOMENTUM WEALTH', appClass: 'MasLauncher' };

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

const FFMPEG_PATH = await resolveFfmpegPath();
const FFMPEG_AVAILABLE = FFMPEG_PATH !== undefined;

/** Format duration in seconds, read from ffmpeg's own demuxer report. */
function probeDurationSeconds(ffmpegPath: string, videoPath: string): number {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', videoPath], { encoding: 'utf-8' });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(`${result.stderr ?? ''}`);
  if (match === null) throw new Error(`ffmpeg reported no Duration for ${videoPath}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** Frames ffmpeg actually decodes — proves frames are held, not dropped. */
function probeDecodedFrameCount(ffmpegPath: string, videoPath: string): number {
  const result = spawnSync(
    ffmpegPath,
    ['-hide_banner', '-i', videoPath, '-map', '0:v:0', '-f', 'null', '-'],
    { encoding: 'utf-8' }
  );
  const matches = [...`${result.stderr ?? ''}`.matchAll(/frame=\s*(\d+)/g)];
  if (matches.length === 0) throw new Error(`ffmpeg decoded no frames from ${videoPath}`);
  return Number(matches[matches.length - 1][1]);
}

describe('frame timeline', () => {
  it('gives each frame the real gap to the next and holds the last until stop', () => {
    expect(computeFrameDurations([1_000, 6_200, 11_050], 17_080)).toEqual([5.2, 4.85, 6.03]);
  });

  it('clamps a zero or negative hold from a post-stop top-up to a minimum', () => {
    expect(computeFrameDurations([5_000, 5_000, 5_100], 4_900)).toEqual([0.05, 0.1, 0.05]);
  });

  it('yields no durations for no frames', () => {
    expect(computeFrameDurations([], 1_000)).toEqual([]);
  });

  it('writes a concat list with one duration per frame and a repeated final file', () => {
    expect(buildConcatFile(['frame-0001.png', 'frame-0002.png'], [5.2, 4.85])).toBe(
      [
        'ffconcat version 1.0',
        "file 'frame-0001.png'",
        'duration 5.200',
        "file 'frame-0002.png'",
        'duration 4.850',
        "file 'frame-0002.png'",
        '',
      ].join('\n')
    );
  });

  it('builds a valid single-frame list so one frame is never zero-length', () => {
    const list = buildConcatFile(['frame-0001.png'], [6.03]);
    expect(list.match(/file 'frame-0001\.png'/g)).toHaveLength(2);
    expect(list).toContain('duration 6.030');
  });

  it('rejects a frame/duration length mismatch', () => {
    expect(() => buildConcatFile(['frame-0001.png'], [1, 2])).toThrow();
  });
});

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

  it('defers on tool windows, then films the app window that appears AFTER the recorder starts', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Only VW tool windows are live: the recorder must defer, not film the launcher.
    expect(recorder.frameCount).toBe(0);
    expect(vw.render).not.toHaveBeenCalled();

    appOpen = true;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    const calls = vi.mocked(vw.render).mock.calls.map((call) => call[0] as { windowTitle?: string });
    expect(calls.every((opts) => opts.windowTitle === APP_WINDOW.title)).toBe(true);
    expect(recording.warning).toBeUndefined();
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

describe('VW tool-window deferral', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const TOOL_WINDOW = { title: 'storeTst64 (C:\\visualworks931\\image)', appClass: 'VisualLauncher' };

  it('captures nothing while only VW tool windows exist, then warns if no app window ever appears', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW]),
      getActionLog: vi.fn(() => []),
    });

    const recorder = startVideoRecording(vw)!;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(recorder.frameCount).toBe(0);
    expect(vw.render).not.toHaveBeenCalled();

    const recording = await recorder.stop();
    // Last resort at stop: evidence exists, but the warning is explicit.
    expect(recording.frameCount).toBeGreaterThanOrEqual(2);
    expect(recording.warning).toContain('tool window');
    expect(recording.warning).toContain('no application window');
    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: TOOL_WINDOW.title })
    );
    await recording.discard();
  });

  it('falls back to a tool window during the run once the bounded wait expires', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW]),
      getActionLog: vi.fn(() => []),
    });

    const recorder = startVideoRecording(vw, { targetWaitMs: 50 })!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    expect(recording.warning).toContain('tool window');
    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: TOOL_WINDOW.title })
    );
    await recording.discard();
  });

  it('never defers or filters an explicit override that names a VW tool window', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    const vw = makeVw({
      listWindows: vi.fn(async () => [TOOL_WINDOW]),
      getActionLog: vi.fn(() => []),
    });

    const recorder = startVideoRecording(vw, { windowTitle: TOOL_WINDOW.title })!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    expect(recording.warning).toBeUndefined();
    expect(vw.render).toHaveBeenCalledWith(
      expect.objectContaining({ windowTitle: TOOL_WINDOW.title })
    );
    await recording.discard();
  });
});

describe('video assembly', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('builds concat/vfr encode args that preserve real frame durations', () => {
    const args = buildVideoEncodeArgs('frames.txt', 'out.mp4');
    expect(args).toContain('libx264');
    expect(args).toContain('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(args).not.toContain('-framerate');
    expect(args[args.indexOf('-f') + 1]).toBe('concat');
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('vfr');
    expect(args[args.indexOf('-bf') + 1]).toBe('0');
    expect(args[args.indexOf('-i') + 1]).toBe('frames.txt');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it.skipIf(!FFMPEG_AVAILABLE)(
    'matches assembled duration to the recorded wall clock and keeps every frame',
    async () => {
      const ffmpegPath = FFMPEG_PATH;
      if (ffmpegPath === undefined) throw new Error('ffmpeg unavailable');

      vi.stubEnv('VW_VIDEO', '1');
      vi.stubEnv('VW_VIDEO_FPS', '10');
      const vw = makeVw({
        render: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return makeBgraFrame();
        }),
      });
      const recorder = startVideoRecording(vw)!;
      const startedAt = Date.now();
      await waitForFrames(recorder, 3);
      const stoppedAt = Date.now();
      const recording = await recorder.stop();
      const wallClockSeconds = (stoppedAt - startedAt) / 1000;

      const keepDir = mkdtempSync(join(tmpdir(), 'vw-video-measure-'));
      let videoPath: string | undefined;
      const attach = vi.fn(async (name: string, options?: unknown) => {
        if (name !== 'video.mp4') return;
        videoPath = join(keepDir, 'video.mp4');
        copyFileSync((options as { path: string }).path, videoPath);
      });

      await recording.attach({ attach } as unknown as AttachableTestInfo);
      const capturedVideo = videoPath;
      if (capturedVideo === undefined) throw new Error('video.mp4 was not attached');

      const durationSeconds = probeDurationSeconds(ffmpegPath, capturedVideo);
      const decodedFrames = probeDecodedFrameCount(ffmpegPath, capturedVideo);
      rmSync(keepDir, { recursive: true, force: true });

      // The concat list repeats the final file so its duration is consumed; that
      // repeat is itself one extra image input, so ffmpeg decodes n + 1 frames.
      // Nothing is dropped: every captured frame is present.
      expect(decodedFrames).toBe(recording.frameCount + 1);
      expect(Math.abs(durationSeconds - wallClockSeconds)).toBeLessThan(1);
    }
  );

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


