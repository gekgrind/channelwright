# Platform planning requirements

Verified on **2026-08-09** from official TikTok and Meta/Facebook documentation. Platform rules change; `src/domain/platform-constraints.ts` is the single typed configuration used by fixture agents and QA.

## Current configurable defaults

| Target | Planning format | Planning duration | Validation boundary |
| --- | --- | --- | --- |
| TikTok | 9:16, target 1080×1920, minimum 720p | 15–90 seconds | Before any future direct post, query the creator's current `max_video_post_duration_sec`; the permitted maximum varies by account. Preview safe zones. |
| Instagram/Facebook Reels | 9:16, target 1080×1920, minimum 720p and 30 FPS | 15–90 seconds | The 90-second ceiling is a conservative shared-media planning default based on Facebook Reels, not a claim that every Instagram surface shares the same maximum. Preview both destinations. |

The target 1080×1920 dimensions are a Channelwright production preference, not a claimed minimum. Exact codecs, file-size ceilings, caption lengths, and pixel safe-zone insets are intentionally not enforced while this repository produces plans rather than media. Safe zones vary with platform UI and caption treatment, so QA requires destination previews instead of relying on invented fixed margins.

## Official sources

- [TikTok Query Creator Info](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info): the creator-specific maximum video duration must be queried for direct posting.
- [TikTok Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines): latest creator info, user control, preview, audit restrictions, music disclosures, and no unwanted promotional watermarks.
- [TikTok Creative guidance for vertical recuts](https://ads.tiktok.com/business/creativecenter/quicktok/online/Creating_Made_Easier/pc/en): 9:16 vertical framing, immediate action, sound, and platform-previewed safe zones.
- [Meta/Facebook: Reel size and aspect ratios on Instagram](https://www.facebook.com/help/1038071743007909): accepted aspect-ratio range, minimum 720p resolution, and minimum 30 FPS.
- [Meta/Facebook: Create a reel on Facebook](https://www.facebook.com/help/www/2862139500770200): Facebook Reels described as up to 90 seconds.

Meta's public developer publishing-spec pages were not reliably retrievable during this verification pass. The accessible official Help Center material supports the conservative planning defaults above, but a future renderer/publisher must re-check current Instagram Graph API and Facebook publishing specifications before enforcing codecs, file sizes, or API eligibility.

## Publishing limitations

Channelwright currently has no YouTube master renderer, object storage integration, FFprobe-style media inspection, TikTok/Meta OAuth, platform app review, upload, or publishing adapter. TikTok documents that unaudited Direct Post clients are private-only and subject to additional caps. No package in this repository should display “ready to export” or “ready to publish” until those capabilities exist and validate an actual media asset.
