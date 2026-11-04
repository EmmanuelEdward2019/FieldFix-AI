import type { DeviceTypeOption } from "./device-options";

export interface ProblemCategory {
  value: string;
  label: string;
  /** Editable starter text for the symptoms field. */
  defaultSymptoms: string;
}

const POWER: ProblemCategory = {
  value: "power",
  label: "Power & Startup",
  defaultSymptoms: "The device will not power on or start up.",
};

const BATTERY: ProblemCategory = {
  value: "battery",
  label: "Battery & Charging",
  defaultSymptoms: "The battery drains fast or the device will not charge.",
};

const NETWORK: ProblemCategory = {
  value: "network",
  label: "Network & Connectivity",
  defaultSymptoms: "The device cannot connect to Wi-Fi or the network reliably.",
};

export const PROBLEM_CATEGORIES: Record<DeviceTypeOption, ProblemCategory[]> = {
  laptop: [
    POWER,
    BATTERY,
    {
      value: "display",
      label: "Display & Graphics",
      defaultSymptoms: "The display is blank, flickers, or shows graphics glitches.",
    },
    {
      value: "keyboard",
      label: "Keyboard & Touchpad",
      defaultSymptoms: "Keys or the touchpad respond intermittently or not at all.",
    },
    {
      value: "overheating",
      label: "Overheating",
      defaultSymptoms: "The device overheats and shuts down under load. The fan is loud.",
    },
    {
      value: "performance",
      label: "Performance",
      defaultSymptoms: "The device is unusually slow or freezes during normal use.",
    },
    {
      value: "storage",
      label: "Storage & Memory",
      defaultSymptoms: "The system reports disk errors or runs out of memory.",
    },
    NETWORK,
    {
      value: "audio",
      label: "Audio & Peripherals",
      defaultSymptoms: "Speakers, microphone, or connected peripherals do not work.",
    },
  ],
  desktop: [
    POWER,
    BATTERY,
    {
      value: "display",
      label: "Display & Graphics",
      defaultSymptoms: "No display on boot, or graphics glitches under load.",
    },
    {
      value: "keyboard",
      label: "Keyboard & Peripherals",
      defaultSymptoms: "Keyboard, mouse, or connected peripherals do not respond.",
    },
    {
      value: "overheating",
      label: "Overheating",
      defaultSymptoms: "The machine overheats and shuts down under load. Fans are loud.",
    },
    {
      value: "performance",
      label: "Performance",
      defaultSymptoms: "The machine is unusually slow or freezes during normal use.",
    },
    {
      value: "storage",
      label: "Storage & Memory",
      defaultSymptoms: "The system reports disk errors or runs out of memory.",
    },
    NETWORK,
    {
      value: "audio",
      label: "Audio",
      defaultSymptoms: "Speakers or microphone do not work.",
    },
  ],
  smartphone: [
    POWER,
    BATTERY,
    {
      value: "screen",
      label: "Screen & Touch",
      defaultSymptoms: "The screen or touchscreen does not respond properly.",
    },
    {
      value: "camera",
      label: "Camera",
      defaultSymptoms: "The camera app crashes or photos come out black or blurry.",
    },
    {
      value: "speaker",
      label: "Speaker & Microphone",
      defaultSymptoms: "Callers cannot hear me, or the speaker crackles.",
    },
    NETWORK,
    {
      value: "software",
      label: "Software & Performance",
      defaultSymptoms: "The phone is slow, apps crash, or updates fail.",
    },
    {
      value: "physical",
      label: "Physical Damage",
      defaultSymptoms: "The phone was dropped or exposed to liquid and now misbehaves.",
    },
  ],
};
