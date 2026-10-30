// services/tgl-ops/src/agents/prospect-researcher/sources/meta-ads.ts

let reportedSkipped = false;

export function resetMetaAdsBrowserState(): void {
  reportedSkipped = false;
}

export async function closeMetaAdsBrowser(): Promise<void> {
  // No-op: Apify web-scraper manages browser lifecycles remotely
}

export interface MetaAdCheckResult {
  active: boolean;
  adCount: number;
  adLibraryUrl: string;
}

/**
 * Checks the public Meta Ad Library web page for active ad campaigns using Apify web-scraper.
 * When APIFY_API_TOKEN is missing, logs notice once and returns clean defaults.
 * Zero dependency on local Chromium or Playwright binaries in the runtime.
 */
export async function checkMetaAdLibrary(
  companyName: string,
  options?: { testMode?: boolean }
): Promise<MetaAdCheckResult> {
  const cleanName = companyName
    .replace(/\s+(hospital|clinic|centre|center|super speciality|institute|multispeciality).*$/i, "")
    .trim();

  const queryTerm = cleanName || companyName;
  const adLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${encodeURIComponent(
    queryTerm
  )}&search_type=keyword_unordered&media_type=all`;

  if (options?.testMode) {
    // In test mode, return deterministic verification
    return {
      active: true,
      adCount: 4,
      adLibraryUrl,
    };
  }

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    if (!reportedSkipped) {
      console.log(`[Meta Ad Library] skipped: no browser (APIFY_API_TOKEN not configured)`);
      reportedSkipped = true;
    }
    return {
      active: false,
      adCount: 0,
      adLibraryUrl,
    };
  }

  try {
    console.log(`[Apify Meta Ad Library] Running apify~web-scraper for '${queryTerm}'`);
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~web-scraper/run-sync-get-dataset-items?token=${apifyToken}&timeout=30`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startUrls: [{ url: adLibraryUrl }],
          maxRequestsPerCrawl: 1,
          pageFunction:
            "async function pageFunction(context) { const { page } = context; await page.waitForTimeout(2000); const bodyText = await page.innerText('body').catch(() => ''); return { bodyText }; }",
        }),
        signal: AbortSignal.timeout(35000),
      }
    );

    if (res.ok) {
      const items = (await res.json()) as any;
      if (Array.isArray(items) && items.length > 0 && items[0].bodyText) {
        const bodyText = items[0].bodyText as string;
        const noAdsIndicators = [
          "0 results",
          "No results found",
          "We didn't find any ads",
          "No ads match your search criteria",
        ];

        const hasNoAds = noAdsIndicators.some((ind) =>
          bodyText.toLowerCase().includes(ind.toLowerCase())
        );

        let adCount = 0;
        const countMatch = bodyText.match(/~?(\d+)\s+results?/i);
        if (countMatch) {
          adCount = parseInt(countMatch[1], 10);
        } else {
          const libraryIdMatches = bodyText.match(/Library ID:\s*\d+/gi);
          if (libraryIdMatches) {
            adCount = libraryIdMatches.length;
          }
        }

        const active = !hasNoAds && adCount > 0;
        return {
          active,
          adCount: active ? adCount : 0,
          adLibraryUrl,
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Apify Meta Scraper Warning]:`, err.message || err);
  }

  return {
    active: false,
    adCount: 0,
    adLibraryUrl,
  };
}
