/**
 * @enviro365/vw-test-sdk-core — public surface (L1).
 */

// Client + options
export { VWTestClient } from './client.js';
export type { VWClientOptions } from './options.js';
export {
  DEFAULT_BRIDGE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ACTION_LOG_CAPACITY,
  DEFAULT_WINDOW_TREE_CACHE_TTL_MS,
  defaultTokenFile,
  resolveTokenFile,
} from './options.js';

// Version contract
export { SDK_VERSION, REQUIRES_BRIDGE_MIN, REQUIRES_BRIDGE_MAX_MAJOR } from './version.js';

// Errors
export {
  VWTestSDKError,
  BridgeCompatibilityError,
  EvalGuardError,
  NoGBSSessionError,
  WidgetNotFoundError,
  WindowNotFoundError,
  TimeoutError,
  ExclusiveBridgeViolationError,
  ConcurrentBridgeActivityError,
  IncompleteCleanupError,
} from './errors.js';

// Window + handles
export { WindowScope } from './window.js';
export { WidgetHandle, findWidgetByAspect } from './handles/widget.js';
export { CheckboxHandle } from './handles/checkbox.js';
export { TableHandle } from './handles/table.js';
export type { RowMatch } from './handles/table.js';
export { ListHandle } from './handles/list.js';
export { DialogScope } from './handles/dialog.js';
export type { WidgetContext } from './handles/context.js';

// Page object base
export { VWPage } from './page.js';

// Wait
export { ALL_WAIT_PREDICATE_KINDS } from './wait.js';
export type { WaitPredicate, WaitOptions } from './wait.js';

// Screenshot
export type { ScreenshotOptions } from './screenshot.js';

// In-image render (POST /render)
export type { RenderOptions, HighlightedRenderFrame } from './render.js';

// Interaction highlighting for captured evidence
export {
  buildWidgetRectSource,
  parseWidgetRect,
  composeHighlightBorder,
  composeTargetBox,
  composeClickDot,
  composeCursorGlyph,
  composeRipple,
  composeLabel,
  composeInteractionOverlay,
  composeInteractionTimeline,
  highlightColorForPurpose,
  isHighlightEnabled,
  findLatestInteraction,
  findRecordedInteractionAt,
  findRecordedTimelineAt,
  semanticActionLabel,
  DEFAULT_HIGHLIGHT_THICKNESS,
  RIPPLE_LIFE_MS,
  MAX_RIPPLES,
  LABEL_HOLD_MS,
  LABEL_FADE_MS,
} from './highlight.js';
export type {
  ActionGeometry,
  ComposeClickDotOptions,
  ComposeCursorGlyphOptions,
  ComposeLabelOptions,
  ComposeInteractionOverlayOptions,
  ComposeInteractionTimelineOptions,
  ComposeRippleOptions,
  ComposeTargetBoxOptions,
  HighlightPurpose,
  HighlightRenderOptions,
  InteractionOverlay,
  InteractionTarget,
  LabelAnchor,
  Point,
  RecordedInteraction,
  RecordedTimeline,
  RgbColor,
  RgbaColor,
  WidgetRect,
} from './highlight.js';

// Embedded bitmap font (action labels)
export {
  FONT_ADVANCE,
  FONT_FIRST_CHAR,
  FONT_GLYPH_HEIGHT,
  FONT_GLYPH_WIDTH,
  FONT_GLYPHS,
  FONT_LAST_CHAR,
  drawText,
  measureText,
} from './font.js';
export type { FontGlyph, TextColor, TextMeasurement } from './font.js';

// Action log
export { ActionLog } from './actionLog.js';
export type { ActionEvent } from './actionLog.js';

// Eval guards
export { checkEvalSafety } from './evalGuards.js';
export type { EvalGuardResult } from './evalGuards.js';

// Smalltalk helpers
export { quoteSmalltalkString, sanitizeTestName, testArtifactPrefix } from './smalltalk.js';

// Shared types
export type {
  WindowSummary,
  WidgetNode,
  WidgetValueResult,
  BridgeCapabilities,
  StateSnapshot,
  ForeignCaller,
  CleanupOptions,
  CleanupReport,
} from './types.js';

// Convenience re-exports of the bridge-client essentials
export { BridgeClient, BridgeError } from '@enviro365/vw-bridge-client';
export type {
  BridgeClientLike,
  BridgeHealth,
  BridgeVersion,
  BridgeEvalResult,
  RenderTarget,
  RenderSource,
  RenderRequestOptions,
  RenderFrame,
} from '@enviro365/vw-bridge-client';
