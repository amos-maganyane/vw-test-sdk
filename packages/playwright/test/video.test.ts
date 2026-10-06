import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  startVideoRecording,
  resolveFfmpegPath,
  buildVideoEncodeArgs,
  buildFrameNormaliseArgs,
  buildFrameNormaliseFilterScript,
  computeCanvasSize,
  composeRecordedInteractionOverlay,
  framesNeedNormalisation,
  resolveEncodeOptions,
  resolveVideoRetainPolicy,
  resolveVideoSource,
  shouldRetainVideo,
  type VideoRecorder,
  type RecordedVideo,
} from '../src/video.js';
import { buildConcatFile, computeFrameDurations } from '../src/frameTimeline.js';
import type { AttachableTestInfo } from '../src/evidence.js';
import type { ActionEvent, VWTestClient } from '@enviro365/vw-test-sdk-core';

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
      source: 'os',
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

  it('captures with the colour-correct os source, or in-image when VW_VIDEO_SOURCE opts in', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    vi.stubEnv('VW_VIDEO_SOURCE', 'in-image');
    const vw = makeVw();
    const recorder = startVideoRecording(vw)!;
    await waitForFrames(recorder, 1);
    const recording = await recorder.stop();

    expect(vw.render).toHaveBeenCalledWith(expect.objectContaining({ source: 'in-image' }));
    await recording.discard();
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

  it('clamps an invalid VW_VIDEO_FPS to the 2 fps default', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', 'banana');
    const recorder = startVideoRecording(makeVw());
    expect(recorder?.fps).toBe(2);
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

/** Dimensions of the first video stream — proves every frame shares one canvas. */
function probeVideoDimensions(
  ffmpegPath: string,
  videoPath: string
): { width: number; height: number } {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', videoPath], { encoding: 'utf-8' });
  const streamLine = `${result.stderr ?? ''}`
    .split(/\r?\n/)
    .find((line) => line.includes(' Video: '));
  const match = /(\d{2,5})x(\d{2,5})/.exec(streamLine ?? '');
  if (match === null) throw new Error(`ffmpeg reported no video dimensions for ${videoPath}`);
  return { width: Number(match[1]), height: Number(match[2]) };
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

  it('defaults to CRF 18 and preset slow with the even-padding filter and no thread cap', () => {
    const args = buildVideoEncodeArgs('frames.txt', 'out.mp4');
    expect(args[args.indexOf('-crf') + 1]).toBe('18');
    expect(args[args.indexOf('-preset') + 1]).toBe('slow');
    expect(args[args.indexOf('-vf') + 1]).toBe('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(args[args.indexOf('-vf') + 1]).not.toContain('scale=');
    expect(args).not.toContain('-threads');
  });

  it('applies CRF, preset and thread overrides', () => {
    const args = buildVideoEncodeArgs('frames.txt', 'out.mp4', {
      crf: 20,
      preset: 'medium',
      threads: 4,
    });
    expect(args[args.indexOf('-crf') + 1]).toBe('20');
    expect(args[args.indexOf('-preset') + 1]).toBe('medium');
    expect(args[args.indexOf('-threads') + 1]).toBe('4');
  });

  it('downscales to the configured max size without upscaling', () => {
    const args = buildVideoEncodeArgs('frames.txt', 'out.mp4', { maxWidth: 800, maxHeight: 800 });
    const filter = args[args.indexOf('-vf') + 1];
    expect(filter).toContain(
      "scale='min(iw,800)':'min(ih,800)':force_original_aspect_ratio=decrease"
    );
    expect(filter).toContain('pad=ceil(iw/2)*2:ceil(ih/2)*2');
  });

  it('ignores a partial max-size cap so the filter stays the even-padding filter', () => {
    const args = buildVideoEncodeArgs('frames.txt', 'out.mp4', { maxWidth: 800 });
    expect(args[args.indexOf('-vf') + 1]).toBe('pad=ceil(iw/2)*2:ceil(ih/2)*2');
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

  it.skipIf(!FFMPEG_AVAILABLE)(
    'normalises frames of different sizes onto one canvas before assembly',
    async () => {
      const ffmpegPath = FFMPEG_PATH;
      if (ffmpegPath === undefined) throw new Error('ffmpeg unavailable');

      vi.stubEnv('VW_VIDEO', '1');
      vi.stubEnv('VW_VIDEO_FPS', '10');
      const sizes = [
        { width: 64, height: 48 },
        { width: 100, height: 80 },
      ];
      let callIndex = 0;
      const vw = makeVw({
        render: vi.fn(async () => {
          const size = sizes[callIndex % sizes.length];
          callIndex += 1;
          return makeBgraFrame(size.width, size.height);
        }),
      });
      const recorder = startVideoRecording(vw)!;
      await waitForFrames(recorder, 3);
      const recording = await recorder.stop();
      expect(recording.frameCount).toBeGreaterThanOrEqual(3);

      const frameDir = dirname(recording.framePaths[0]);
      let filterExistedAtAttach = false;

      const keepDir = mkdtempSync(join(tmpdir(), 'vw-video-canvas-'));
      let videoPath: string | undefined;
      const attach = vi.fn(async (name: string, options?: unknown) => {
        if (name !== 'video.mp4') return;
        filterExistedAtAttach = existsSync(join(frameDir, 'normalise.filter'));
        videoPath = join(keepDir, 'video.mp4');
        copyFileSync((options as { path: string }).path, videoPath);
      });
      await recording.attach({ attach } as unknown as AttachableTestInfo);
      if (videoPath === undefined) throw new Error('video.mp4 was not attached');

      const dimensions = probeVideoDimensions(ffmpegPath, videoPath);
      const decodedFrames = probeDecodedFrameCount(ffmpegPath, videoPath);
      rmSync(keepDir, { recursive: true, force: true });

      expect(filterExistedAtAttach).toBe(true);
      expect(dimensions).toEqual({ width: 100, height: 80 });
      expect(decodedFrames).toBe(recording.frameCount + 1);
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

describe('frame canvas normalisation', () => {
  it('uses the even max width/height across frames so nothing is upscaled', () => {
    expect(
      computeCanvasSize([
        { width: 831, height: 322 },
        { width: 1000, height: 793 },
      ])
    ).toEqual({ width: 1000, height: 794 });
  });

  it('returns undefined for no frames', () => {
    expect(computeCanvasSize([])).toBeUndefined();
  });

  it('flags only frame sets that differ from the canvas', () => {
    const canvas = { width: 100, height: 80 };
    expect(framesNeedNormalisation([{ width: 100, height: 80 }], canvas)).toBe(false);
    expect(
      framesNeedNormalisation(
        [
          { width: 64, height: 48 },
          { width: 100, height: 80 },
        ],
        canvas
      )
    ).toBe(true);
  });

  it('builds one scale-to-fit + pad chain per input, ending in its output label', () => {
    expect(buildFrameNormaliseFilterScript(2, { width: 500, height: 400 })).toBe(
      [
        '[0:v]scale=500:400:force_original_aspect_ratio=decrease:flags=lanczos,pad=500:400:(ow-iw)/2:(oh-ih)/2:color=black[n0];',
        '[1:v]scale=500:400:force_original_aspect_ratio=decrease:flags=lanczos,pad=500:400:(ow-iw)/2:(oh-ih)/2:color=black[n1]',
        '',
      ].join('\n')
    );
  });

  it('maps each normalised output one-for-one and rejects a length mismatch', () => {
    const args = buildFrameNormaliseArgs(
      ['a.png', 'b.png'],
      ['a.norm.png', 'b.norm.png'],
      'normalise.filter'
    );
    expect(args).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'a.png',
      '-i',
      'b.png',
      '-filter_complex_script',
      'normalise.filter',
      '-map',
      '[n0]',
      'a.norm.png',
      '-map',
      '[n1]',
      'b.norm.png',
    ]);
    expect(() => buildFrameNormaliseArgs(['a.png'], [], 'normalise.filter')).toThrow();
  });
});

describe('video encode options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults to CRF 18 and preset slow when no VW_VIDEO_* overrides are set', () => {
    expect(resolveEncodeOptions()).toEqual({ crf: 18, preset: 'slow' });
  });

  it('maps VW_VIDEO_CRF, VW_VIDEO_PRESET, VW_VIDEO_THREADS and VW_VIDEO_MAX_SIZE', () => {
    vi.stubEnv('VW_VIDEO_CRF', '23');
    vi.stubEnv('VW_VIDEO_PRESET', 'veryfast');
    vi.stubEnv('VW_VIDEO_THREADS', '2');
    vi.stubEnv('VW_VIDEO_MAX_SIZE', '800x600');
    expect(resolveEncodeOptions()).toEqual({
      crf: 23,
      preset: 'veryfast',
      threads: 2,
      maxWidth: 800,
      maxHeight: 600,
    });
  });

  it('ignores invalid CRF, preset, thread and max-size values without throwing', () => {
    vi.stubEnv('VW_VIDEO_CRF', '999');
    vi.stubEnv('VW_VIDEO_PRESET', 'turbo');
    vi.stubEnv('VW_VIDEO_THREADS', '0');
    vi.stubEnv('VW_VIDEO_MAX_SIZE', 'garbage');
    expect(resolveEncodeOptions()).toEqual({ crf: 18, preset: 'slow' });
  });
});

describe('video retention policy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to on-failure when VW_VIDEO_RETAIN is unset', () => {
    delete process.env['VW_VIDEO_RETAIN'];
    expect(resolveVideoRetainPolicy()).toBe('on-failure');
  });

  it('reads VW_VIDEO_RETAIN=always', () => {
    vi.stubEnv('VW_VIDEO_RETAIN', 'always');
    expect(resolveVideoRetainPolicy()).toBe('always');
  });

  it('treats an unknown VW_VIDEO_RETAIN as on-failure', () => {
    vi.stubEnv('VW_VIDEO_RETAIN', 'sometimes');
    expect(resolveVideoRetainPolicy()).toBe('on-failure');
  });

  it('retains a genuine failure under on-failure but not a plain pass', () => {
    expect(shouldRetainVideo('failed', 'passed', 'on-failure')).toBe(true);
    expect(shouldRetainVideo('passed', 'passed', 'on-failure')).toBe(false);
    expect(shouldRetainVideo('passed', 'failed', 'on-failure')).toBe(true);
  });

  it('retains every result under always', () => {
    expect(shouldRetainVideo('passed', 'passed', 'always')).toBe(true);
    expect(shouldRetainVideo('failed', 'passed', 'always')).toBe(true);
  });
});

describe('video render source', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to os and only accepts in-image as the opt-in', () => {
    delete process.env['VW_VIDEO_SOURCE'];
    expect(resolveVideoSource()).toBe('os');
    vi.stubEnv('VW_VIDEO_SOURCE', 'in-image');
    expect(resolveVideoSource()).toBe('in-image');
    vi.stubEnv('VW_VIDEO_SOURCE', 'banana');
    expect(resolveVideoSource()).toBe('os');
  });
});

describe('recorded interaction overlay', () => {
  const WIDTH = 64;
  const HEIGHT = 64;

  function pixel(bytes: Uint8Array, x: number, y: number): number[] {
    const i = (y * WIDTH + x) * 4;
    return [bytes[i], bytes[i + 1], bytes[i + 2]];
  }

  it('bakes box, dot and cursor from the recorded geometry at the frame timestamp', () => {
    const bytes = new Uint8Array(WIDTH * HEIGHT * 4);
    const events: ActionEvent[] = [
      {
        ts: 1_000,
        kind: 'click',
        ok: true,
        detail: { aspect: 'btnSearch', rect: { x: 8, y: 8, width: 20, height: 20 } },
      },
    ];
    const painted = composeRecordedInteractionOverlay(bytes, WIDTH, HEIGHT, events, 2_000);
    expect(painted).toBeGreaterThan(0);
    // box stroke on the exact bbox (51 = #333)
    expect(pixel(bytes, 8, 8)).toEqual([51, 51, 51]);
    // click point is the rect centre (18,18): cursor tip white, dot over the fill left of it
    expect(pixel(bytes, 18, 18)).toEqual([255, 255, 255]);
    expect(pixel(bytes, 10, 18)).toEqual([11, 6, 179]);
  });

  it('ignores interactions recorded after the frame and logs without geometry', () => {
    const bytes = new Uint8Array(16 * 16 * 4);
    const future: ActionEvent[] = [
      { ts: 5_000, kind: 'click', ok: true, detail: { rect: { x: 2, y: 2, width: 4, height: 4 } } },
    ];
    expect(composeRecordedInteractionOverlay(bytes, 16, 16, future, 1_000)).toBe(0);
    expect(composeRecordedInteractionOverlay(bytes, 16, 16, [], 1_000)).toBe(0);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it('bakes frames without asking the client for a capture-time border', async () => {
    vi.stubEnv('VW_VIDEO', '1');
    vi.stubEnv('VW_VIDEO_FPS', '10');
    vi.stubEnv('VW_HIGHLIGHT', '1');
    const events: ActionEvent[] = [
      {
        ts: Date.now() - 500,
        kind: 'click',
        ok: true,
        detail: { aspect: 'btnSearch', windowTitle: WINDOW.title, rect: { x: 4, y: 4, width: 12, height: 12 } },
      },
    ];
    const vw = makeVw({ getActionLog: vi.fn(() => events) });
    const recorder = startVideoRecording(vw)!;
    await waitForFrames(recorder, 2);
    const recording = await recorder.stop();

    const renderCalls = vi
      .mocked(vw.render)
      .mock.calls.map(([opts]) => opts as Record<string, unknown>);
    expect(renderCalls.length).toBeGreaterThanOrEqual(2);
    expect(renderCalls.every((opts) => opts['highlight'] === undefined)).toBe(true);
    await recording.discard();
  });
});


