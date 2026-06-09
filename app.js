/**
 * app.js — Global Pathways download page logic
 *
 * Loadable as a browser ES module (<script type="module">) and by
 * Node's built-in test runner ("node --test").
 *
 * Exports (pure, Node-safe):
 *   detectOS, pickWindowsInstaller, fetchLatestRelease, chooseAction
 *
 * DOM layer (browser-only, guarded):
 *   applyView, init
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

// ─── View-model ──────────────────────────────────────────────────────────────

/**
 * Decide what to show based on detected OS and the fetch outcome.
 *
 * Pure function — no DOM, no side effects. Safe to call in Node tests.
 *
 * @param {"windows"|"macos"|"other"} os
 * @param {{version: string, assets: Array<{name: string, browser_download_url: string}>} | Error | null} releaseOrError
 *   Pass the resolved release object on success, an Error on fetch failure,
 *   or null when called before the fetch resolves (pre-fetch state).
 * @returns {
 *   {kind: "download", href: string, version: string} |
 *   {kind: "notPublished"} |
 *   {kind: "fetchFailed"} |
 *   {kind: "unsupported", os: string}
 * }
 */
export function chooseAction(os, releaseOrError) {
  // Non-Windows visitors always get the "unsupported" view regardless of fetch state.
  if (os !== "windows") {
    return { kind: "unsupported", os };
  }

  // Windows + fetch not yet resolved (null) → treat as fetchFailed (pre-hydration fallback).
  if (releaseOrError === null) {
    return { kind: "fetchFailed" };
  }

  // Windows + fetch error.
  if (releaseOrError instanceof Error) {
    return { kind: "fetchFailed" };
  }

  // Windows + fetch success.
  const release = releaseOrError;
  const installer = pickWindowsInstaller(release.assets);

  if (installer) {
    return { kind: "download", href: installer.browser_download_url, version: release.version };
  }

  return { kind: "notPublished" };
}

// ─── DOM layer (browser-only) ─────────────────────────────────────────────────

const RELEASES_URL = "https://github.com/WatsonWBlair/IAS/releases/latest";
const API_URL = "https://api.github.com/repos/WatsonWBlair/IAS/releases/latest";

/**
 * Apply a view-model to the live document.
 * Replaces the contents of #action-slot and fills #version-label.
 * Does NOT modify #os-region — that is handled by init() directly.
 *
 * @param {{kind: string, href?: string, version?: string, os?: string}} view
 * @param {Document} doc
 */
export function applyView(view, doc) {
  const actionSlot = doc.getElementById("action-slot");
  const versionLabel = doc.getElementById("version-label");

  if (!actionSlot) return;

  switch (view.kind) {
    case "download": {
      actionSlot.innerHTML =
        `<a href="${view.href}">Download for Windows (.msi)</a>`;
      if (versionLabel) versionLabel.textContent = view.version ?? "";
      break;
    }

    case "notPublished": {
      actionSlot.innerHTML =
        `<a href="${RELEASES_URL}">Go to the downloads page</a>` +
        `<p class="note">The Windows installer has not been published yet. ` +
        `Check the downloads page for the latest release.</p>`;
      if (versionLabel) versionLabel.textContent = "";
      break;
    }

    case "fetchFailed": {
      actionSlot.innerHTML =
        `<a href="${RELEASES_URL}">Go to the downloads page</a>` +
        `<p class="note">We could not load release information right now. ` +
        `Use the link above to go to the downloads page directly.</p>`;
      if (versionLabel) versionLabel.textContent = "";
      break;
    }

    case "unsupported": {
      // #action-slot: no active download button — clear the slot entirely.
      actionSlot.innerHTML = "";
      if (versionLabel) versionLabel.textContent = "";
      break;
    }
  }
}

/**
 * Paint the OS-region hero text for non-Windows visitors.
 *
 * @param {"windows"|"macos"|"other"} os
 * @param {Document} doc
 */
function applyOsRegion(os, doc) {
  const osRegion = doc.getElementById("os-region");
  if (!osRegion) return;

  if (os !== "windows") {
    osRegion.innerHTML =
      `<h1>Global Pathways</h1>` +
      `<p class="subtitle">English language practice for everyday life</p>` +
      `<p class="os-notice">` +
        `There is no download for your system yet — ` +
        `please contact the Pace IAS office.` +
      `</p>` +
      `<p><a href="${RELEASES_URL}" class="releases-link">See all downloads</a></p>`;
  }
  // Windows visitors keep the default static markup; nothing to change.
}

/**
 * Mark the instructions block as Windows-only for non-Windows visitors.
 *
 * @param {"windows"|"macos"|"other"} os
 * @param {Document} doc
 */
function applyInstructionsLabel(os, doc) {
  const instructions = doc.getElementById("instructions");
  if (!instructions || os === "windows") return;

  const notice = doc.createElement("p");
  notice.className = "os-notice";
  notice.textContent = "Note: These instructions are for Windows only.";
  instructions.prepend(notice);
}

/**
 * Main entry point — runs on DOMContentLoaded in the browser.
 * Detects OS synchronously, paints the hero, then fetches the release
 * and applies the resulting view (catching errors into the fetchFailed path).
 *
 * Exported for testing the wiring logic in isolation if needed.
 */
export async function init() {
  const os = detectOS();

  // Paint the hero synchronously, before the fetch resolves.
  applyOsRegion(os, document);
  applyInstructionsLabel(os, document);

  // Show a pre-fetch fallback in the action slot for Windows visitors
  // while the fetch is in flight.
  if (os === "windows") {
    applyView({ kind: "fetchFailed" }, document);
  } else {
    applyView({ kind: "unsupported", os }, document);
  }

  // Fetch the release and apply the real view.
  try {
    const release = await fetchLatestRelease(API_URL);
    applyView(chooseAction(os, release), document);
  } catch (err) {
    // Don't surface raw error text to the learner — fetchFailed view handles it.
    applyView(chooseAction(os, err), document);
  }
}

// ─── Browser bootstrap ────────────────────────────────────────────────────────

// Guard: only auto-run when a real browser document is present.
// Importing this module under `node --test` must not touch the DOM or throw.
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}
