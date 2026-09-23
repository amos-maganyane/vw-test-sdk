/**
 * frameTimeline.ts — wall-clock timing for buffered /render frames.
 *
 * The recorder samples the in-image POST /render route roughly every
 * `1000 / VW_VIDEO_FPS` milliseconds, but a sample costs a request round-trip,
 * an in-image render (~66ms) and a client-side PNG encode (see png.ts), so the
 * real capture rate is far below the nominal one and varies with the machine.
 *
 * The previous assembler handed the PNGs to ffmpeg's image2 demuxer with a
 * nominal `-framerate N`. image2 derives the output duration as
 * `frame_count / N`, so the mp4's length ignored how long the test actually ran
 * and every screen transition landed at the wrong point on the timeline. Every
 * mature recorder (Playwright, Cypress, Puppeteer) instead timestamps each frame
 * and lets ffmpeg hold it until the next timestamp; this module computes those
 * hold times and renders the ffmpeg concat-demuxer list that carries them into
 * the mp4, which is the only still-image input that preserves a per-frame
 * duration (see video.ts for the encode invocation).
 */

/**
 * Smallest any frame is held, in seconds. A live recording that captures during
 * the post-stop top-up (see video.ts) can produce a zero or negative final
 * interval; the clamp keeps every frame — and therefore the whole video —
 * non-zero-length.
 */
export const MIN_FRAME_DURATION_SECONDS = 0.05;

/**
 * Real per-frame hold times, in seconds, for a sequence of frames sampled at
 * `sampledAtMs` and a recording that stopped at `stoppedAtMs`.
 *
 * Frame `i` is displayed from the moment it was sampled until frame `i + 1` was
 * sampled — so the screen a viewer sees at time `t` is the screen that was live
 * in the test at time `t`. The final frame is held from its sample time until
 * the recorder stopped, which extends the video to the end of the recording.
 *
 * Every interval is clamped to `minSeconds` so clock skew, a post-stop top-up
 * capture, or a zero gap never yields a zero-length frame.
 */
export function computeFrameDurations(
  sampledAtMs: readonly number[],
  stoppedAtMs: number,
  minSeconds: number = MIN_FRAME_DURATION_SECONDS
): number[] {
  const durations: number[] = [];
  for (let i = 0; i < sampledAtMs.length; i += 1) {
    const holdUntilMs = i + 1 < sampledAtMs.length ? sampledAtMs[i + 1] : stoppedAtMs;
    durations.push(Math.max(minSeconds, (holdUntilMs - sampledAtMs[i]) / 1000));
  }
  return durations;
}

/**
 * Render an `ffconcat` list. Each `file` is followed by the hold time until the
 * next file; the final file is written a second time WITHOUT a duration.
 *
 * The repeat is load-bearing. The concat demuxer consumes a `duration` only
 * when a following file's start time is emitted, so a trailing `duration` with
 * no following `file` is dropped: with the repeat omitted, ffmpeg 6.1 shortened
 * a 9.0s list to 5.04s (measured). The repeated entry forces the last hold into
 * the output and the mp4 reports the full wall-clock length.
 *
 * `paths` must be bare frame file names (no directory separators) with the list
 * written into the same directory: the concat demuxer resolves relative names
 * against the list file's own directory, so no path escaping is ever needed.
 */
export function buildConcatFile(paths: readonly string[], durations: readonly number[]): string {
  if (paths.length !== durations.length) {
    throw new Error(
      `buildConcatFile: ${paths.length} frame path(s) but ${durations.length} duration(s)`
    );
  }
  if (paths.length === 0) throw new Error('buildConcatFile: at least one frame is required');

  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < paths.length; i += 1) {
    lines.push(`file '${paths[i]}'`);
    lines.push(`duration ${durations[i].toFixed(3)}`);
  }
  // Repeat the final file so the last duration is actually consumed (see above).
  lines.push(`file '${paths[paths.length - 1]}'`);
  return `${lines.join('\n')}\n`;
}
