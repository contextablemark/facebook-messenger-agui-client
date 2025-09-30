/**
 * Thin compatibility layer that re-exports the shared AG-UI dispatcher from the
 * gateway core package. The service code imports from this module so the
 * integration tests continue to exercise the canonical implementation while the
 * consumer-facing path remains stable.
 */
export { createAguiDispatcher, buildRunInput } from '@agui-gw/core';
export type {
  AguiDispatcher,
  AguiDispatcherOptions,
  DispatchContext,
  AguiDispatchHandlers,
  AssistantMessagePayload,
  RunLifecyclePayload,
  RunErrorPayload,
} from '@agui-gw/core';
