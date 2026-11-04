import type { DeviceType } from "@fieldfix/contracts";

/**
 * Deterministic component vocabularies per device type. SAM concept
 * prompts must name one concrete object, so callers either pass
 * explicit concepts or get these defaults — one provider call each.
 * Labels stored on annotations come from these prompts, never from
 * model output, so segmentation cannot smuggle in fault claims.
 */

const LAPTOP_COMPONENTS = [
  "battery",
  "keyboard",
  "trackpad",
  "screen",
  "webcam",
  "cooling vent",
  "power port",
  "hinge",
] as const;

const SMARTPHONE_COMPONENTS = [
  "screen",
  "battery",
  "camera",
  "charging port",
  "speaker",
  "side button",
  "back cover",
  "sim tray",
] as const;

const DESKTOP_COMPONENTS = [
  "power supply",
  "motherboard",
  "graphics card",
  "memory module",
  "cpu cooler",
  "storage drive",
  "front panel",
  "cooling fan",
] as const;

export const MAX_CONCEPTS_PER_REQUEST = 8;

export function defaultComponents(deviceType: DeviceType): string[] {
  if (deviceType === "desktop") {
    return [...DESKTOP_COMPONENTS];
  }
  return [...(deviceType === "laptop" ? LAPTOP_COMPONENTS : SMARTPHONE_COMPONENTS)];
}
