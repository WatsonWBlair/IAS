/**
 * app.js — Global Pathways download page logic
 *
 * Loadable as a browser ES module (<script type="module">) and by
 * Node's built-in test runner ("node --test").
 */

/**
 * Classify a user-agent / platform string into one of three OS families.
 *
 * @param {string} [uaOrPlatform] - Navigator user-agent or platform string.
 *   Defaults to `navigator.userAgent` when called with no argument in the browser.
 * @returns {"windows" | "macos" | "other"}
 */
export function detectOS(uaOrPlatform) {
  const ua =
    uaOrPlatform !== undefined
      ? uaOrPlatform
      : (typeof navigator !== "undefined" ? navigator.userAgent : "");

  const s = ua.toLowerCase();

  // Catch UAs that contain an explicit iOS/iPadOS token (iphone, ipad, ipod).
  // Note: an iPad in "Request Desktop Site" mode sends a UA with "Macintosh"
  // and NO ipad/iphone/ipod token, so it is NOT caught here — it falls through
  // to the macOS branch and is classified as "macos". That is acceptable: both
  // "macos" and "other" route to the same "no build for your system" state.
  if (/iphone|ipad|ipod/.test(s)) return "other";

  if (/windows/.test(s)) return "windows";
  if (/macintosh|mac os x|darwin/.test(s)) return "macos";

  return "other";
}

/**
 * Pick the first asset whose filename ends in ".msi", or null if none exists.
 *
 * @param {Array<{name: string, browser_download_url: string}>} assets
 * @returns {{name: string, browser_download_url: string} | null}
 */
export function pickWindowsInstaller(assets) {
  if (!Array.isArray(assets)) return null;
  return assets.find((a) => typeof a.name === "string" && a.name.endsWith(".msi")) ?? null;
}

/**
 * Fetch the latest GitHub release and normalize it.
 *
 * @param {string} repoUrl - Full GitHub API URL, e.g.
 *   "https://api.github.com/repos/WatsonWBlair/IAS/releases/latest"
 * @param {function} [fetchFn] - Injectable fetch implementation; defaults to
 *   the global `fetch` when not supplied (browser / Node 18+).
 * @returns {Promise<{version: string, notes: string, assets: Array<{name: string, browser_download_url: string}>}>}
 * @throws {Error} when the HTTP response is not ok (status >= 400).
 */
export async function fetchLatestRelease(
  repoUrl = "https://api.github.com/repos/WatsonWBlair/IAS/releases/latest",
  fetchFn = globalThis.fetch
) {
  const response = await fetchFn(repoUrl);

  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status} for ${repoUrl}`
    );
  }

  const data = await response.json();

  return {
    version: data.tag_name,
    notes: data.body,
    assets: (data.assets ?? []).map(({ name, browser_download_url }) => ({
      name,
      browser_download_url,
    })),
  };
}
