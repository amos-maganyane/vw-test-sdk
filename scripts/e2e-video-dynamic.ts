/**
 * e2e-video-dynamic.ts — live proof that the failure-video recorder resolves its
 * render target DYNAMICALLY.
 *
 * Scenario (mirrors the real failure): at bridge start the only live windows are
 * VW tool windows. The recorder starts, then a NEW window appears AFTER start.
 * The recorder must pick it up and capture non-blank frames from it.
 *
 * Run: pnpm tsx scripts/e2e-video-dynamic.ts
 * Requires: live bridge (profile=test) + ffmpeg-static.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VWTestClient } from '@enviro365/vw-test-sdk-core';
import { startVideoRecording, resolveFfmpegPath } from '../packages/playwright/src/video.js';

const TARGET_TITLE = 'Workspace';
const OPEN_WORKSPACE =
  `[[Tools.Workbook open. 'OPENED'] on: Core.Notification do: [:n | n resume. 'RESUMED']] ` +
  `on: Core.Exception do: [:e | 'ERR: ' , e messageText]`;
const CLOSE_WORKSPACE =
  `ScheduledControllers scheduledControllers do: [:c | ` +
  `(c view notNil and: [c view label asString = '${TARGET_TITLE}']) ifTrue: ` +
  `[[c view close] on: Core.Exception do: [:e | nil]]]. 'closed'`;

function distinctColours(bgra: Buffer): number {
  const seen = new Set<number>();
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    seen.add((bgra[i] << 16) | (bgra[i + 1] << 8) | bgra[i + 2]);
  }
  return seen.size;
}

async function main(): Promise<void> {
  const vw = new VWTestClient();
  const frameDir = mkdtempSync(join(tmpdir(), 'vw-video-e2e-'));
  const ffmpeg = await resolveFfmpegPath();
  if (ffmpeg === undefined) throw new Error('ffmpeg not found');

  console.log('1. bridge health:', JSON.stringify(await vw.health()));

  await vw.evaluate(CLOSE_WORKSPACE);
  await new Promise((r) => setTimeout(r, 500));
  const before = await vw.listWindows();
  console.log('2. windows at start:', before.map((w) => w.title).join(' | '));
  if (before.some((w) => w.title.includes(TARGET_TITLE))) {
    throw new Error('target window still open — aborting to keep the test honest');
  }

  process.env['VW_VIDEO'] = '1';
  process.env['VW_VIDEO_FPS'] = '4';
  const recorder = startVideoRecording(vw, { frameDir });
  if (recorder === undefined) throw new Error('recorder did not start');
  console.log('3. recorder started (target not yet resolved)');

  await new Promise((r) => setTimeout(r, 600));
  console.log(`4. frames before target window exists: ${recorder.frameCount}`);

  await vw.evaluate(OPEN_WORKSPACE);
  await new Promise((r) => setTimeout(r, 800));
  const after = await vw.listWindows();
  console.log('5. windows after open:', after.map((w) => w.title).join(' | '));
  if (!after.some((w) => w.title.includes(TARGET_TITLE))) {
    throw new Error('target window did not open');
  }

  await vw.getWidgetValue('importSummary', TARGET_TITLE);
  console.log('6. recorded an interactive action naming the target window');

  await new Promise((r) => setTimeout(r, 1500));
  const recording = await recorder.stop();
  console.log(`7. frames after target window: ${recording.frameCount}`);

  if (recording.frameCount < 2) {
    throw new Error(`expected >= 2 frames, got ${recording.frameCount} (warning: ${recording.warning})`);
  }

  const lastFrame = recording.framePaths[recording.framePaths.length - 1];
  const rawPath = join(frameDir, 'last.bgra');
  const conv = spawnSync(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', lastFrame, '-f', 'rawvideo', '-pix_fmt', 'bgra', rawPath],
    { windowsHide: true }
  );
  if (conv.status !== 0) throw new Error(`ffmpeg png->bgra failed: ${conv.stderr?.toString()}`);
  const bgra = readFileSync(rawPath);
  const colours = distinctColours(bgra);
  console.log(`8. last frame ${statSync(lastFrame).size} bytes PNG -> ${bgra.length} bytes BGRA, distinct colours: ${colours}`);

  const targetWindow = after.find((w) => w.title.includes(TARGET_TITLE));
  const bounds = typeof targetWindow?.['bounds'] === 'string' ? targetWindow['bounds'] : '';
  const dims = /(\d+)\s*@\s*(\d+)\s*corner:\s*(\d+)\s*@\s*(\d+)/.exec(bounds);
  if (dims !== null) {
    const width = Number(dims[3]) - Number(dims[1]);
    const height = Number(dims[4]) - Number(dims[2]);
    const expected = width * height * 4;
    console.log(`8b. target window bounds "${bounds}" -> ${width}x${height}, expected ${expected} bytes; frame ${bgra.length} bytes`);
    if (bgra.length !== expected) {
      throw new Error(`recorder did not target the ${TARGET_TITLE} window (frame ${bgra.length} != ${expected})`);
    }
  }

  const mp4 = join(frameDir, 'video.mp4');
  const enc = spawnSync(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', '4', '-start_number', '1',
     '-i', join(frameDir, 'frame-%04d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
     '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', mp4],
    { windowsHide: true }
  );
  if (enc.status !== 0) throw new Error(`ffmpeg encode failed: ${enc.stderr?.toString()}`);
  console.log(`9. mp4 assembled: ${statSync(mp4).size} bytes`);

  rmSync(frameDir, { recursive: true, force: true });
  console.log(`10. cleaned up (${existsSync(frameDir) ? 'frames remain' : 'frames deleted'})`);

  if (colours < 2) throw new Error(`frame is blank (${colours} distinct colour(s))`);
  console.log('E2E PASSED: window appearing after recorder start was captured non-blank');
}

main().catch((err: unknown) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
