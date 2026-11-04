export type DeviceTypeOption = "laptop" | "desktop" | "smartphone";

/** Select value meaning "not in the list — use the custom field". */
export const OTHER_VALUE = "__other";

export const MANUFACTURERS: Record<DeviceTypeOption, string[]> = {
  laptop: [
    "Apple",
    "Dell",
    "HP",
    "Lenovo",
    "Asus",
    "Acer",
    "Microsoft",
    "Samsung",
    "MSI",
    "Razer",
  ],
  desktop: [
    "Dell",
    "HP",
    "Lenovo",
    "Apple",
    "Asus",
    "Acer",
    "MSI",
    "Custom-built",
  ],
  smartphone: [
    "Apple",
    "Samsung",
    "Google",
    "OnePlus",
    "Xiaomi",
    "Motorola",
    "Nothing",
  ],
};

const MODELS: Record<string, Partial<Record<DeviceTypeOption, string[]>>> = {
  Apple: {
    laptop: ["MacBook Air", "MacBook Pro"],
    desktop: ["iMac", "Mac mini", "Mac Studio", "Mac Pro"],
    smartphone: ["iPhone 16", "iPhone 15", "iPhone 14", "iPhone SE"],
  },
  Dell: {
    laptop: ["XPS 13", "XPS 15", "Inspiron 15", "Latitude 5540", "Precision 3581"],
    desktop: ["XPS Desktop", "OptiPlex 7010", "Alienware Aurora"],
  },
  HP: {
    laptop: ["Spectre x360", "Envy x360", "Pavilion 15", "EliteBook 840", "ProBook 450"],
    desktop: ["Pavilion Desktop", "Envy Desktop", "Omen 25L"],
  },
  Lenovo: {
    laptop: ["ThinkPad X1 Carbon", "ThinkPad T14", "Yoga 9i", "IdeaPad Slim 5", "Legion 5"],
    desktop: ["ThinkCentre M75", "Legion Tower 5", "IdeaCentre 3"],
  },
  Asus: {
    laptop: ["Zenbook 14", "Vivobook 15", "ROG Zephyrus G14", "TUF Gaming F15"],
    desktop: ["ROG Strix G15", "ProArt Station"],
  },
  Acer: {
    laptop: ["Swift 3", "Aspire 5", "Predator Helios 300", "Nitro 5"],
    desktop: ["Aspire Desktop", "Predator Orion 3000"],
  },
  Microsoft: {
    laptop: ["Surface Laptop", "Surface Pro", "Surface Laptop Go"],
    desktop: ["Surface Studio 2+"],
  },
  Samsung: {
    laptop: ["Galaxy Book4", "Galaxy Book4 Pro"],
    smartphone: ["Galaxy S25", "Galaxy S24", "Galaxy Z Flip 6", "Galaxy Z Fold 6", "Galaxy A55"],
  },
  MSI: {
    laptop: ["GF63 Thin", "Katana 15", "Raider GE78"],
    desktop: ["Trident 3", "Codex R"],
  },
  Razer: {
    laptop: ["Blade 14", "Blade 15", "Blade 16"],
  },
  Google: {
    smartphone: ["Pixel 9", "Pixel 9 Pro", "Pixel 8", "Pixel 8a"],
  },
  OnePlus: {
    smartphone: ["OnePlus 12", "OnePlus 11", "OnePlus Nord 4"],
  },
  Xiaomi: {
    smartphone: ["Xiaomi 14", "Xiaomi 13", "Redmi Note 13"],
  },
  Motorola: {
    smartphone: ["Edge 50", "Moto G85", "Razr 50"],
  },
  Nothing: {
    smartphone: ["Phone (2)", "Phone (2a)", "CMF Phone 1"],
  },
};

/** Curated models for a manufacturer + device type (empty when unknown). */
export function modelsFor(manufacturer: string, device: DeviceTypeOption): string[] {
  return MODELS[manufacturer]?.[device] ?? [];
}
