/**
 * video.ts — opt-in failure video (VW_VIDEO=1).
 *
 * Polls the in-image POST /render route at VW_VIDEO_FPS (default 1) and buffers
 * PNG frames on disk. /render draws one window's view into an offscreen Pixmap
 * inside the image, so capture does not depend on the Windows desktop: occluded,
 * unfocused and fully off-screen windows render correctly (the old OS-screenshot
 * source failed into black video when the desktop was locked or RDP dropped).
 *
 * TARGET RESOLUTION IS DYNAMIC. At bridge start the only live windows are VW
 * tool windows (VisualLauncher / GbxVisualLauncher / Workbook); the window a
 * test actually drives appears only once the test opens it. A target resolved
 * once at construction would therefore film a tool window, and a statically
 * configured VW_VIDEO_WINDOW naming the app window would 404 on every run
 * because the window does not exist yet. So the recorder re-resolves lazily:
 * it prefers the window named by the most recent interactive action in the
 * test's own action log (`vw.getActionLog()`), then the failure-screenshot
 * window heuristic, and re-resolves whenever the current target stops matching
 * a live window.
 *
 * TOOL WINDOWS ARE NEVER EVIDENCE. VW's own tool windows are not the app under
 * test; filming them dominated the finished video (a 27.8 s recording whose MAS
 * window appeared only in the last few frames, while the rest held a flat
 * launcher). So the recorder DEFERS its first capture until a plausible
 * application window exists, bounded by `VW_VIDEO_TARGET_WAIT_MS` (default
 * 30_000, clamped to [0, 300_000]): before that bound a known tool window is
 * never rendered. When an app window appears, the timeline simply starts there
 * (the deferred period is represented by the recorder starting when the window
 * appeared, never by launcher frames). At `stop()` — or once the bound expires —
 * if NO app window was ever seen, the recorder films a tool window only as a
 * last resort and reports a clear warning. An explicit `windowTitle` / `appClass`
 * (or VW_VIDEO_WINDOW / VW_VIDEO_APP_CLASS) is a hard override: it is neither
 * deferred nor filtered.
 *
 * Each /render frame is raw BGRA, re-encoded to PNG client-side (see png.ts).
 * Every frame is stamped with a wall-clock capture time, and assembly (see
 * frameTimeline.ts) turns those into per-frame hold times fed to ffmpeg's concat
 * demuxer, so the mp4's duration and each screen transition match the real test
 * timeline rather than a nominal frame rate. Assembly runs once at test end via
 * ffmpeg (VW_FFMPEG_PATH, system PATH, or the optional ffmpeg-static dependency);
 * when ffmpeg is missing or fails, the raw frames are attached instead and the
 * test result is never affected.
 *
 * The capture loop is a single unref'd interval with an in-flight guard: frame
 * I/O is async so the test's event loop is never blocked and a slow capture is
 * never stacked onto. `stop()` clears the timer, waits (bounded) for the
 * capture that was in flight, then tops up (bounded) to the video minimum —
 * a short test can end before the first interval tick fires, so without the
 * top-up it would attach zero frames.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ActionEvent, RenderOptions, VWTestClient, WindowSummary } from '@enviro365/vw-test-sdk-core';
import { selectEvidenceWindow, type AttachableTestInfo } from './evidence.js';
import { buildConcatFile, computeFrameDurations } from './frameTimeline.js';
import { inspectFrame } from './frameGuard.js';
import { encodeBgraToPng } from './png.js';

const DEFAULT_FPS = 1;
const MIN_FPS = 0.1;
const MAX_FPS = 10;
const FRAME_CAPTURE_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 10_000;
const FFMPEG_TIMEOUT_MS = 120_000;
const MIN_FRAMES_FOR_VIDEO = 2;
/** Assembly needs at least one frame; a single frame becomes a valid held still. */
const MIN_FRAMES_TO_ASSEMBLE = 1;
const MAX_FALLBACK_FRAMES = 60;
const CONCAT_LIST_NAME = 'frames.txt';
const NO_TARGET_MESSAGE = 'no VisualWorks window available to render';
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
/**
 * How long the recorder waits for an application window before it gives up and
 * films a VW tool window as last-resort evidence. Deferring is preferred
 * because the tool windows present at recorder start (VisualLauncher,
 * GbxVisualLauncher, Workbook) are not the app the test drives. Bounded so an
 * app-less test still yields evidence plus a clear warning, never silence.
 */
const DEFAULT_TARGET_WAIT_MS = 30_000;
const MAX_TARGET_WAIT_MS = 300_000;

/** appClass values of VW's own tool windows — never useful failure evidence. */
const VW_TOOL_APP_CLASSES: ReadonlySet<string> = new Set([
  'VisualLauncher',
  'GbxVisualLauncher',
  'Workbook',
]);

/**
 * Title shapes of VW's own tool windows — belt-and-braces for the (unlikely)
 * case the bridge omits `appClass`. Covers the launchers (storeTst64 /
 * storedev64 / VisualWorks) and the two generic tool windows by exact title.
 */
const VW_TOOL_TITLE_PATTERN = /storeTst64|storedev64|VisualWorks|^(?:Workspace|GemStone Launcher)$/i;

/** True when `window` is one of VW's own tool windows (never dynamically filmed). */
function isVwToolWindow(window: WindowSummary): boolean {
  const appClass = window['appClass'];
  if (typeof appClass === 'string' && VW_TOOL_APP_CLASSES.has(appClass)) return true;
  return VW_TOOL_TITLE_PATTERN.test(window.title);
}

export interface VideoRecordingOptions {
  /** Capture rate; default `VW_VIDEO_FPS` ?? 1, clamped to [0.1, 10]. */
  fps?: number;
  /** Frame buffer directory; default a fresh `vw-test-sdk-video-*` dir under os.tmpdir(). */
  frameDir?: string;
  /**
   * Explicit window to render (title substring). When set (or `VW_VIDEO_WINDOW`
   * is set) it is a hard override: the recorder never re-resolves away from it.
   * Otherwise the target is resolved dynamically from the test's action log.
   */
  windowTitle?: string;
  /** Explicit VW application class to disambiguate the target; default `VW_VIDEO_APP_CLASS`. */
  appClass?: string;
  /**
   * Max ms to defer the first capture while only VW tool windows exist; default
   * `VW_VIDEO_TARGET_WAIT_MS` ?? 30_000, clamped to [0, 300_000]. Ignored when an
   * explicit `windowTitle` / `appClass` override is configured.
   */
  targetWaitMs?: number;
  /**
   * Composite a high-contrast border at the most recent widget interaction into
   * every frame; default `VW_HIGHLIGHT` env (truthy). The border is painted into
   * the frame buffer before PNG encoding, so it appears in the assembled video.
   */
  highlight?: boolean;
}

/** The window POST /render targets (exactly one source is needed by the bridge). */
interface RenderWindow {
  windowTitle?: string;
  appClass?: string;
}

export interface VideoRecorder {
  /** Configured capture rate (the encode rate is corrected from real timestamps). */
  readonly fps: number;
  /** Frames successfully buffered so far. */
  readonly frameCount: number;
  /** Stop the loop and return the recording. Never throws; safe to call twice. */
  stop(): Promise<RecordedVideo>;
}

export interface RecordedVideo {
  readonly frameCount: number;
  readonly framePaths: readonly string[];
  /** Playback rate derived from the real frame timestamps. */
  readonly fps: number;
  readonly warning: string | undefined;
  /** Attach the video (or the raw-frame fallback) to the report, then delete the buffer. Never throws. */
  attach(testInfo: AttachableTestInfo): Promise<void>;
  /** Delete the frame buffer without attaching. Never throws. */
  discard(): Promise<void>;
}

/** Start buffering frames when `VW_VIDEO` is enabled; otherwise a no-op undefined. */
export function startVideoRecording(
  vw: VWTestClient,
  opts: VideoRecordingOptions = {}
): VideoRecorder | undefined {
  if (!TRUTHY_VALUES.has((process.env['VW_VIDEO'] ?? '').toLowerCase())) return undefined;
  try {
    return new FrameRecorder({
      vw,
      fps: resolveFps(opts.fps),
      frameDir: opts.frameDir,
      window: resolveConfiguredWindow(opts),
      targetWaitMs: resolveTargetWaitMs(opts.targetWaitMs),
      highlight: resolveHighlightEnabled(opts),
    });
  } catch (error) {
    console.warn(`vw-test-sdk: video capture disabled — ${messageOf(error)}`);
    return undefined;
  }
}

/**
 * Locate an ffmpeg binary: explicit `VW_FFMPEG_PATH`, then the system PATH,
 * then the optional `ffmpeg-static` package. Returns undefined when none exist.
 */
export async function resolveFfmpegPath(): Promise<string | undefined> {
  const explicit = process.env['VW_FFMPEG_PATH'];
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const onPath = findFfmpegOnPath();
  if (onPath !== undefined) return onPath;
  try {
    const mod: unknown = await import('ffmpeg-static');
    const staticPath = (mod as { default?: unknown }).default;
    return typeof staticPath === 'string' && staticPath.length > 0 ? staticPath : undefined;
  } catch {
    return undefined;
  }
}

export interface FfmpegRunResult {
  ok: boolean;
  reason?: string;
}

export function buildVideoEncodeArgs(concatListPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    // The concat list carries a real wall-clock duration per frame; image2's
    // nominal `-framerate` cannot (it derives duration as count / rate).
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatListPath,
    // Preserve the per-frame durations instead of forcing a constant rate.
    '-fps_mode',
    'vfr',
    // yuv420p needs even dimensions; VW window/screen rects are not guaranteed even.
    '-vf',
    'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v',
    'libx264',
    // B-frames make the mov muxer under-report duration (the last frames decode
    // before an edit list adjusts the start; measured 7.04s for a 9.0s timeline).
    // Disabling them keeps the container Duration equal to the frame timeline.
    '-bf',
    '0',
    '-preset',
    'slow',
    // Evidence is slideshow-like (few sharp frames held for seconds), which is exactly
    // what `stillimage` tunes for. CRF 18 is visually near-lossless; the default 23
    // visibly blurs text in screenshots. yuv420p is kept so the result stays playable
    // in browsers (yuv444p/high444 is not), and the colour tags below stop a player
    // guessing the range/matrix, which is the usual cause of washed-out output.
    '-tune',
    'stillimage',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-color_range',
    'tv',
    '-colorspace',
    'bt709',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'iec61966-2-1',
    '-movflags',
    '+faststart',
    outputPath,
  ];
}

/** Construction inputs for {@link FrameRecorder} (kept as one object: >3 fields). */
interface FrameRecorderConfig {
  vw: VWTestClient;
  fps: number;
  frameDir: string | undefined;
  window: RenderWindow | undefined;
  targetWaitMs: number;
  highlight: boolean;
}

class FrameRecorder implements VideoRecorder, RecordedVideo {
  readonly fps: number;
  readonly frameDir: string;
  private readonly vw: VWTestClient;
  private readonly configuredWindow: RenderWindow | undefined;
  private readonly targetWaitMs: number;
  private readonly highlightEnabled: boolean;
  private readonly startedAt: number;
  private readonly paths: string[] = [];
  private readonly times: number[] = [];
  private resolvedWindow: RenderWindow | undefined;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private captureError: string | undefined;
  private warningValue: string | undefined;
  private stopPromise: Promise<RecordedVideo> | null = null;
  private stoppedAt: number | undefined;
  private discarded = false;
  /** True once a non-tool (application) window has been resolved and filmed. */
  private appWindowSeen = false;
  /** True once `stop()` has been requested — removes the deferral bound. */
  private stopRequested = false;
  /** Title of the VW tool window filmed as a last resort, when that happened. */
  private toolFallbackTitle: string | undefined;

  constructor(config: FrameRecorderConfig) {
    this.vw = config.vw;
    this.fps = config.fps;
    this.frameDir = config.frameDir ?? join(tmpdir(), `vw-test-sdk-video-${process.pid}-${Date.now()}`);
    this.configuredWindow = config.window;
    this.targetWaitMs = config.targetWaitMs;
    this.highlightEnabled = config.highlight;
    this.startedAt = Date.now();
    mkdirSync(this.frameDir, { recursive: true });
    this.timer = setInterval(() => void this.captureFrame(), Math.round(1000 / this.fps));
    this.timer.unref();
    void this.captureFrame();
  }

  get frameCount(): number {
    return this.paths.length;
  }

  get framePaths(): readonly string[] {
    return this.paths;
  }

  get warning(): string | undefined {
    return this.warningValue;
  }

  stop(): Promise<RecordedVideo> {
    this.stopPromise ??= this.finish();
    return this.stopPromise;
  }

  private async finish(): Promise<RecordedVideo> {
    this.stopRequested = true;
    // Stamp the stop before waiting: the final frame is held until the recording
    // actually stopped, not until assembly runs.
    this.stoppedAt ??= Date.now();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const deadline = Date.now() + STOP_GRACE_MS;
    const pending = this.inFlight;
    if (pending !== null) {
      // A capture that was in flight when the test ended is allowed to land —
      // the frame belongs to the test and the screenshot has already been paid for.
      await Promise.race([pending, delay(Math.max(1, deadline - Date.now()))]);
    }
    await this.topUpToMinimumFrames(deadline);
    this.warningValue = this.buildWarning();
    return this;
  }

  /**
   * A recording that captured nothing must say so loudly: silent emptiness is
   * the failure this recorder exists to eliminate. A transient target miss is
   * reported as such (the test never opened a window the recorder could film);
   * any other capture error is surfaced verbatim.
   */
  private buildWarning(): string | undefined {
    if (this.paths.length === 0) {
      if (this.captureError === undefined) {
        return 'no frames captured (recorder stopped before the first capture completed)';
      }
      if (this.isTransientTargetMiss()) {
        return `no frames captured: ${this.captureError} — the test never opened a window the recorder could film`;
      }
      return `no frames captured; last capture error: ${this.captureError}`;
    }
    const notes: string[] = [];
    if (this.toolFallbackTitle !== undefined) {
      notes.push(
        `filmed VW tool window "${this.toolFallbackTitle}" because no application window appeared — the video is launcher-only, not the app under test`
      );
    }
    if (!this.appWindowSeen && this.configuredWindow === undefined) {
      notes.push('no application window was ever seen');
    }
    if (this.captureError !== undefined) {
      notes.push(`frame capture error: ${this.captureError}`);
    }
    return notes.length > 0 ? notes.join('; ') : undefined;
  }

  /**
   * A short test can stop the recorder before the interval ever produced a
   * frame, so keep capturing — bounded by the same stop grace — until a video
   * is possible. Stops on the first failed capture: the interval loop already
   * retries a transient "no window yet" miss while the test runs, so the top-up
   * must not burn the whole grace window re-trying a target that never appears.
   */
  private async topUpToMinimumFrames(deadline: number): Promise<void> {
    while (this.paths.length < MIN_FRAMES_FOR_VIDEO && this.inFlight === null) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      const capturedBefore = this.paths.length;
      await this.runCapture(Math.max(1_000, Math.min(FRAME_CAPTURE_TIMEOUT_MS, remaining)));
      if (this.paths.length === capturedBefore) return;
    }
  }

  /** True when the last capture failed only because no target window exists yet. */
  private isTransientTargetMiss(): boolean {
    return this.captureError !== undefined && this.captureError.includes(NO_TARGET_MESSAGE);
  }

  private async captureFrame(): Promise<void> {
    if (this.inFlight !== null) return;
    await this.runCapture(FRAME_CAPTURE_TIMEOUT_MS);
  }

  private async runCapture(timeoutMs: number): Promise<void> {
    const run = (async (): Promise<void> => {
      try {
        const window = await this.resolveRenderWindow();
        // Sampled before the request: that is the moment the bridge renders the
        // screen state this frame shows, and it anchors the frame's hold time.
        const sampledAt = Date.now();
        const frame = await this.vw.render(
          renderOptionsFor(window, timeoutMs, this.highlightEnabled)
        );
        const guard = inspectFrame(frame.bytes, frame.width, frame.height);
        if (!guard.clean) {
          this.captureError = `frame refused by content guard: ${guard.reason ?? 'unknown'}`;
          return;
        }
        const png = encodeBgraToPng(frame.bytes, frame.width, frame.height);
        const path = join(this.frameDir, `frame-${String(this.paths.length + 1).padStart(4, '0')}.png`);
        await fs.writeFile(path, png);
        this.paths.push(path);
        this.times.push(sampledAt);
        this.captureError = undefined;
      } catch (error) {
        this.captureError = messageOf(error);
      }
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * Resolve POST /render's window target dynamically.
   *
   * An explicit configured window is a hard override and is returned as-is —
   * never deferred and never filtered. Otherwise the target is the application
   * window the test is driving: the live window named by the most recent
   * interactive action in the test's own action log when it is not a VW tool
   * window, else the failure-screenshot heuristic if that names a non-tool
   * window, else the first non-tool window. VW tool windows are NEVER selected
   * dynamically while no application window has been seen: the recorder throws
   * `NO_TARGET_MESSAGE` (captures nothing) so the deferral period leaves no
   * launcher frames in the timeline. The resolved target is cached and reused
   * while live, but re-resolved when the preferred application window changes —
   * so a window that appears AFTER the recorder starts is picked up on the next
   * tick. As a bounded last resort (see {@link toolFallbackAllowed}) a tool
   * window is filmed, and that fact is surfaced in the recording's warning.
   */
  private async resolveRenderWindow(): Promise<RenderWindow> {
    if (this.configuredWindow !== undefined) return this.configuredWindow;

    const windows = await this.vw.listWindows();

    if (this.resolvedWindow !== undefined && this.isStillLive(this.resolvedWindow, windows)) {
      const preferred = this.selectApplicationWindow(windows);
      if (preferred === undefined || this.matches(this.resolvedWindow, preferred)) {
        return this.resolvedWindow;
      }
    }

    const preferred = this.selectApplicationWindow(windows);
    if (preferred !== undefined) {
      this.appWindowSeen = true;
      return this.rememberTarget(preferred);
    }

    if (!this.appWindowSeen && this.toolFallbackAllowed()) {
      const fallback = selectEvidenceWindow([...windows]) ?? windows[0];
      if (fallback !== undefined) {
        this.toolFallbackTitle ??= fallback.title;
        return this.rememberTarget(fallback);
      }
    }

    throw new Error(NO_TARGET_MESSAGE);
  }

  /** A tool window may be filmed only after the bounded wait, or once stopping. */
  private toolFallbackAllowed(): boolean {
    return this.stopRequested || Date.now() - this.startedAt >= this.targetWaitMs;
  }

  private rememberTarget(window: WindowSummary): RenderWindow {
    const target: RenderWindow = { windowTitle: window.title };
    const appClass = window['appClass'];
    if (typeof appClass === 'string' && appClass.length > 0) target.appClass = appClass;
    this.resolvedWindow = target;
    return target;
  }

  /**
   * The application window to film: action-log window first (when not a tool
   * window), then the failure-screenshot heuristic, then any non-tool window.
   * Returns undefined when only VW tool windows are live.
   */
  private selectApplicationWindow(windows: readonly WindowSummary[]): WindowSummary | undefined {
    const fromLog = this.windowFromActionLog(windows);
    if (fromLog !== undefined && !isVwToolWindow(fromLog)) return fromLog;
    const heuristic = selectEvidenceWindow([...windows]);
    if (heuristic !== undefined && !isVwToolWindow(heuristic)) return heuristic;
    return windows.find((window) => !isVwToolWindow(window));
  }

  /** True when the cached target still matches exactly one live window. */
  private isStillLive(target: RenderWindow, windows: readonly WindowSummary[]): boolean {
    return windows.some((w) => this.matches(target, w));
  }

  private matches(target: RenderWindow, window: WindowSummary): boolean {
    if (target.windowTitle !== undefined && !window.title.includes(target.windowTitle)) return false;
    if (target.appClass !== undefined && window['appClass'] !== target.appClass) return false;
    return true;
  }

  /**
   * Walk the action log newest-first and return the live window named by the
   * first interactive action that carries a window title. `render`/`screenshot`
   * actions are skipped: they are evidence captures, not test interactions, and
   * would otherwise let the recorder's own target pin itself.
   */
  private windowFromActionLog(windows: readonly WindowSummary[]): WindowSummary | undefined {
    const log = this.vw.getActionLog();
    for (let i = log.length - 1; i >= 0; i -= 1) {
      const event = log[i];
      if (!isInteractiveAction(event)) continue;
      const title = actionWindowTitle(event);
      if (title === undefined) continue;
      const match = windows.find((w) => w.title.includes(title));
      if (match !== undefined) return match;
    }
    return undefined;
  }

  private effectiveFps(): number {
    if (this.times.length < 2) return this.fps;
    const first = this.times[0];
    const last = this.times[this.times.length - 1];
    const elapsedSeconds = (last - first) / 1000;
    if (elapsedSeconds <= 0) return this.fps;
    const measured = (this.times.length - 1) / elapsedSeconds;
    return Math.min(MAX_FPS, Math.max(MIN_FPS, measured));
  }

  async attach(testInfo: AttachableTestInfo): Promise<void> {
    try {
      const warning = await this.attachVideoOrExplain(testInfo);
      if (warning !== undefined) await this.attachFrames(testInfo, warning);
    } catch (error) {
      console.warn(`vw-test-sdk: video attach failed — ${messageOf(error)}`);
    } finally {
      await this.discard();
    }
  }

  private async attachVideoOrExplain(testInfo: AttachableTestInfo): Promise<string | undefined> {
    if (this.paths.length < MIN_FRAMES_TO_ASSEMBLE) {
      const cause = this.captureError === undefined ? '' : `; last capture error: ${this.captureError}`;
      return `no frames captured${cause}`;
    }
    const ffmpegPath = await resolveFfmpegPath();
    if (ffmpegPath === undefined) {
      return 'ffmpeg not found — install ffmpeg, set VW_FFMPEG_PATH, or add the optional ffmpeg-static dependency';
    }
    const outputPath = join(this.frameDir, 'video.mp4');
    const listPath = join(this.frameDir, CONCAT_LIST_NAME);
    await fs.writeFile(listPath, this.buildConcatList(), 'utf-8');
    const result = await runFfmpeg(ffmpegPath, buildVideoEncodeArgs(listPath, outputPath));
    if (!result.ok) return `ffmpeg assembly failed: ${result.reason ?? 'unknown error'}`;
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      return 'ffmpeg produced no output file';
    }
    await testInfo.attach('video.mp4', { path: outputPath, contentType: 'video/mp4' });
    console.log(`vw-test-sdk: video attached (${this.paths.length} frame(s) @ ${this.effectiveFps().toFixed(2)} fps)`);
    return undefined;
  }

  /**
   * The concat list that gives every frame its real wall-clock hold time. Frame
   * paths are bare file names: the list is written into the frame directory and
   * the concat demuxer resolves relative names against the list's own directory.
   */
  private buildConcatList(): string {
    const durations = computeFrameDurations(this.times, this.stoppedAt ?? Date.now());
    return buildConcatFile(
      this.paths.map((path) => basename(path)),
      durations
    );
  }

  private async attachFrames(testInfo: AttachableTestInfo, reason: string): Promise<void> {
    const frames = this.paths.slice(-MAX_FALLBACK_FRAMES);
    const firstIndex = this.paths.length - frames.length + 1;
    console.warn(
      `vw-test-sdk: video unavailable (${reason}); attaching ${frames.length} of ${this.paths.length} raw frame(s)`
    );
    for (let i = 0; i < frames.length; i += 1) {
      await testInfo.attach(`video-frames/frame-${String(firstIndex + i).padStart(4, '0')}.png`, {
        path: frames[i],
        contentType: 'image/png',
      });
    }
    await testInfo.attach('video-frames.json', {
      body: JSON.stringify(
        {
          frameCount: this.paths.length,
          attachedFrames: frames.length,
          fps: this.effectiveFps(),
          reason,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
  }

  async discard(): Promise<void> {
    if (this.discarded) return;
    this.discarded = true;
    try {
      await fs.rm(this.frameDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`vw-test-sdk: could not remove video frame buffer ${this.frameDir} — ${messageOf(error)}`);
    }
  }
}

function resolveFps(override: number | undefined): number {
  const raw = override ?? Number.parseFloat(process.env['VW_VIDEO_FPS'] ?? '');
  const fps = Number.isFinite(raw) ? raw : DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, fps));
}

function resolveTargetWaitMs(override: number | undefined): number {
  const raw = override ?? Number.parseFloat(process.env['VW_VIDEO_TARGET_WAIT_MS'] ?? '');
  const ms = Number.isFinite(raw) ? raw : DEFAULT_TARGET_WAIT_MS;
  return Math.min(MAX_TARGET_WAIT_MS, Math.max(0, ms));
}

/** Action kinds that represent the test driving a window (not evidence capture). */
const INTERACTIVE_ACTION_KINDS = new Set([
  'click',
  'fill',
  'type',
  'setDatasetCell',
  'selectRow',
  'menuClick',
  'read',
  'readRows',
  'getValue',
  'open',
  'close',
  'wait',
]);

function isInteractiveAction(event: ActionEvent | undefined): boolean {
  return event !== undefined && event.ok !== false && INTERACTIVE_ACTION_KINDS.has(event.kind);
}

/** The window title an action event carries, if any. */
function actionWindowTitle(event: ActionEvent): string | undefined {
  const detail = event.detail;
  if (detail === undefined) return undefined;
  const title = detail['windowTitle'];
  if (typeof title === 'string' && title.length > 0) return title;
  const window = detail['window'];
  if (typeof window === 'string' && window.length > 0) return window;
  return undefined;
}

function resolveConfiguredWindow(opts: VideoRecordingOptions): RenderWindow | undefined {
  const windowTitle = opts.windowTitle ?? nonEmptyEnv('VW_VIDEO_WINDOW');
  const appClass = opts.appClass ?? nonEmptyEnv('VW_VIDEO_APP_CLASS');
  if (windowTitle === undefined && appClass === undefined) return undefined;
  const window: RenderWindow = {};
  if (windowTitle !== undefined) window.windowTitle = windowTitle;
  if (appClass !== undefined) window.appClass = appClass;
  return window;
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}

function renderOptionsFor(window: RenderWindow, timeoutMs: number, highlight: boolean): RenderOptions {
  const opts: RenderOptions = { timeoutMs, recordAction: false };
  if (window.windowTitle !== undefined) opts.windowTitle = window.windowTitle;
  if (window.appClass !== undefined) opts.appClass = window.appClass;
  if (highlight) opts.highlight = true;
  return opts;
}

function resolveHighlightEnabled(opts: VideoRecordingOptions): boolean {
  if (opts.highlight !== undefined) return opts.highlight;
  return TRUTHY_VALUES.has((process.env['VW_HIGHLIGHT'] ?? '').toLowerCase());
}

function findFfmpegOnPath(): string | undefined {
  const candidates = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-version'], { stdio: 'ignore', windowsHide: true });
    if (probe.error === undefined && probe.status === 0) return candidate;
  }
  return undefined;
}

async function runFfmpeg(ffmpegPath: string, args: readonly string[]): Promise<FfmpegRunResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(ffmpegPath, [...args], { windowsHide: true });
    const killTimer = setTimeout(() => child.kill(), FFMPEG_TIMEOUT_MS);
    const finish = (result: FfmpegRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve(result);
    };
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => finish({ ok: false, reason: error.message }));
    child.on('close', (code) => {
      finish(code === 0 ? { ok: true } : { ok: false, reason: `exit ${String(code)}: ${lastLine(stderr)}` });
    });
  });
}

function lastLine(text: string): string {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines[lines.length - 1] : '(no stderr)';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
