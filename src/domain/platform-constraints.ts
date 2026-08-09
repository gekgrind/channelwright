export const PLATFORM_REQUIREMENTS_VERIFIED_AT = "2026-08-09";

export const platformConstraints = {
  TIKTOK: {
    label: "TikTok",
    aspectRatio: "9:16",
    planningDurationSeconds: { min: 15, max: 90 },
    targetWidth: 1080,
    targetHeight: 1920,
    minimumResolution: 720,
    safeZoneReviewRequired: true,
    durationPolicy: "ACCOUNT_CAPABILITY_REQUIRED",
    sources: [
      "https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info",
      "https://developers.tiktok.com/doc/content-sharing-guidelines",
      "https://ads.tiktok.com/business/creativecenter/quicktok/online/Creating_Made_Easier/pc/en",
    ],
  },
  INSTAGRAM_FACEBOOK_REELS: {
    label: "Instagram/Facebook Reels",
    aspectRatio: "9:16",
    planningDurationSeconds: { min: 15, max: 90 },
    targetWidth: 1080,
    targetHeight: 1920,
    minimumResolution: 720,
    minimumFrameRate: 30,
    safeZoneReviewRequired: true,
    durationPolicy: "CONSERVATIVE_CROSS_PLATFORM_DEFAULT",
    sources: [
      "https://www.facebook.com/help/1038071743007909",
      "https://www.facebook.com/help/www/2862139500770200",
    ],
  },
} as const;

export type PlatformTarget = keyof typeof platformConstraints;
