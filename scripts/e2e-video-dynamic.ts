/**
 * e2e-video-dynamic.ts — live proof that the failure-video recorder resolves its
 * render target DYNAMICALLY and films the APPLICATION window.
 *
 * Scenario (mirrors the real failure): VW tool windows (VisualLauncher,
 * GbxVisualLauncher, Workbook — the flat yellow ones) are live alongside the
 * application window. The recorder must never capture a tool window; it must
 * resolve the application window and produce non-blank frames of it.
 *
 * Requires MAS to be logged in, so the application window already exists.
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

const TARGET_TITLE = process.env['E2E_APP_TITLE'] ?? 'MOMENTUM WEALTH';

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

  const before = await vw.listWindows();
  console.log('2. windows at start:', before.map((w) => w.title).join(' | '));
  if (!before.some((w) => w.title.includes(TARGET_TITLE))) {
    throw new Error(`application window "${TARGET_TITLE}" is not open - log into MAS first`);
  }

  process.env['VW_VIDEO'] = '1';
  process.env['VW_VIDEO_FPS'] = '4';
  const recorder = startVideoRecording(vw, { frameDir });
  if (recorder === undefined) throw new Error('recorder did not start');
  console.log('3. recorder started (target not yet resolved)');

  await new Promise((r) => setTimeout(r, 600));
  console.log(`4. frames captured so far: ${recorder.frameCount}`);

  const after = await vw.listWindows();
  console.log('5. windows while recording:', after.map((w) => w.title).join(' | '));

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
  console.log('E2E PASSED: application window captured non-blank; frame bytes match its bounds');
}

main().catch((err: unknown) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
