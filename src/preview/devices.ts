export interface Device {
  name: string;
  platform: "ios" | "android";
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  cornerRadius: number;
  hasDynamicIsland?: boolean;
  hasNotch?: boolean;
}

export const DEFAULT_DEVICES: Device[] = [
  // iOS
  { name: "iPhone SE (3rd gen)", platform: "ios", width: 375, height: 667, safeTop: 20, safeBottom: 0, cornerRadius: 20 },
  { name: "iPhone 14", platform: "ios", width: 390, height: 844, safeTop: 47, safeBottom: 34, cornerRadius: 44, hasNotch: true },
  { name: "iPhone 14 Plus", platform: "ios", width: 428, height: 926, safeTop: 47, safeBottom: 34, cornerRadius: 44, hasNotch: true },
  { name: "iPhone 14 Pro", platform: "ios", width: 393, height: 852, safeTop: 59, safeBottom: 34, cornerRadius: 44, hasDynamicIsland: true },
  { name: "iPhone 14 Pro Max", platform: "ios", width: 430, height: 932, safeTop: 59, safeBottom: 34, cornerRadius: 44, hasDynamicIsland: true },
  { name: "iPhone 16", platform: "ios", width: 390, height: 844, safeTop: 59, safeBottom: 34, cornerRadius: 44, hasDynamicIsland: true },
  { name: "iPhone 16 Pro", platform: "ios", width: 402, height: 874, safeTop: 62, safeBottom: 34, cornerRadius: 47, hasDynamicIsland: true },
  { name: "iPhone 16 Pro Max", platform: "ios", width: 440, height: 956, safeTop: 62, safeBottom: 34, cornerRadius: 47, hasDynamicIsland: true },
  // Android
  { name: "Samsung Galaxy S24", platform: "android", width: 360, height: 780, safeTop: 40, safeBottom: 24, cornerRadius: 20 },
  { name: "Samsung Galaxy S24+", platform: "android", width: 384, height: 854, safeTop: 40, safeBottom: 24, cornerRadius: 22 },
  { name: "Samsung Galaxy S24 Ultra", platform: "android", width: 412, height: 917, safeTop: 40, safeBottom: 24, cornerRadius: 22 },
  { name: "Google Pixel 9", platform: "android", width: 412, height: 892, safeTop: 40, safeBottom: 24, cornerRadius: 22 },
  { name: "Google Pixel 9 Pro", platform: "android", width: 412, height: 917, safeTop: 40, safeBottom: 24, cornerRadius: 22 },
  { name: "OnePlus 12", platform: "android", width: 412, height: 919, safeTop: 40, safeBottom: 24, cornerRadius: 20 },
];
