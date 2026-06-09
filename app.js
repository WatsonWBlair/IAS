/**
 * app.js — Pace IAS Pronunciation Practice download page logic
 *
 * Loadable as a browser ES module (<script type="module">) and by
 * Node's built-in test runner ("node --test").
 *
 * Exports (pure, Node-safe):
 *   detectOS, pickWindowsInstaller, pickMacInstaller, fetchLatestRelease, chooseAction
 *
 * DOM layer (browser-only, guarded, not exported):
 *   applyView, applyOsRegion, applyInstructionsForOS, init
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
  // to the macOS branch and is classified as "macos". That is acceptable: the
  // macOS download is offered, and an iPad cannot run it anyway, but it is a
  // rare edge case and the macOS install steps make the target clear.
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
 * Pick the first asset whose filename ends in ".dmg", or null if none exists.
 *
 * @param {Array<{name: string, browser_download_url: string}>} assets
 * @returns {{name: string, browser_download_url: string} | null}
 */
export function pickMacInstaller(assets) {
  if (!Array.isArray(assets)) return null;
  return assets.find((a) => typeof a.name === "string" && a.name.endsWith(".dmg")) ?? null;
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

const TRUSTED_ASSET_PREFIXES = [
  "https://github.com/",
  "https://objects.githubusercontent.com/",
];

/** True only for release-asset URLs served from GitHub's own hosts. */
function isTrustedAssetUrl(url) {
  return typeof url === "string" && TRUSTED_ASSET_PREFIXES.some((p) => url.startsWith(p));
}

/** Strip a leading "app-v" / "v" release-tag prefix for display. */
function cleanVersion(rawTag) {
  return (rawTag ?? "").replace(/^(app-v|v)/, "");
}

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
 *   {kind: "download", os: string, href: string, version: string} |
 *   {kind: "notPublished", os: string} |
 *   {kind: "fetchFailed"} |
 *   {kind: "unsupported", os: string}
 * }
 */
export function chooseAction(os, releaseOrError) {
  // Linux / mobile / unknown: no installer is offered for these systems.
  if (os !== "windows" && os !== "macos") {
    return { kind: "unsupported", os };
  }

  // Pre-fetch (null) or fetch error → the same graceful "go to downloads" fallback.
  if (releaseOrError === null || releaseOrError instanceof Error) {
    return { kind: "fetchFailed" };
  }

  // Fetch success — pick the installer for this OS.
  const release = releaseOrError;
  const installer =
    os === "windows"
      ? pickWindowsInstaller(release.assets)
      : pickMacInstaller(release.assets);

  // An installer whose URL is not from a trusted GitHub host is treated as
  // "not published" — never rendered as a download.
  if (installer && isTrustedAssetUrl(installer.browser_download_url)) {
    return {
      kind: "download",
      os,
      href: installer.browser_download_url,
      version: cleanVersion(release.version),
    };
  }

  return { kind: "notPublished", os };
}

// ─── DOM layer (browser-only) ─────────────────────────────────────────────────

const RELEASES_URL = "https://github.com/WatsonWBlair/IAS/releases/latest";
const API_URL = "https://api.github.com/repos/WatsonWBlair/IAS/releases/latest";

/** Per-OS button label (static — never built from release data). */
const DOWNLOAD_LABEL = {
  windows: "Download for Windows (.msi)",
  macos: "Download for macOS (.dmg)",
};

/** Per-OS installer noun for the "not published yet" message (static). */
const INSTALLER_NOUN = {
  windows: "Windows installer",
  macos: "macOS installer",
};

/**
 * Apply a view-model to the live document.
 * Replaces the contents of #action-slot and fills #version-label.
 * Does NOT modify #os-region or the instructions — those are handled separately.
 *
 * @param {{kind: string, os?: string, href?: string, version?: string}} view
 * @param {Document} doc
 */
function applyView(view, doc) {
  const actionSlot = doc.getElementById("action-slot");
  const versionLabel = doc.getElementById("version-label");

  if (!actionSlot) return;

  switch (view.kind) {
    case "download": {
      // Build the anchor with DOM APIs (never innerHTML) so the release-sourced
      // URL cannot be parsed as markup.
      const a = doc.createElement("a");
      a.href = view.href;
      a.textContent = DOWNLOAD_LABEL[view.os] ?? "Download";
      actionSlot.replaceChildren(a);

      // macOS build is Apple-Silicon-only (arm64) and the browser cannot tell
      // Apple Silicon from Intel, so warn every macOS visitor.
      if (view.os === "macos") {
        const note = doc.createElement("p");
        note.className = "note";
        note.textContent =
          "For Apple Silicon Macs (M1 or newer). It will not run on older Intel-based Macs.";
        actionSlot.appendChild(note);
      }

      if (versionLabel) versionLabel.textContent = view.version ? `Version ${view.version}` : "";
      break;
    }

    case "notPublished": {
      const noun = INSTALLER_NOUN[view.os] ?? "installer";
      actionSlot.innerHTML =
        `<a href="${RELEASES_URL}">Go to the downloads page</a>` +
        `<p class="note">The ${noun} has not been published yet. ` +
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
      // No active download button — clear the slot entirely.
      actionSlot.innerHTML = "";
      if (versionLabel) versionLabel.textContent = "";
      break;
    }
  }
}

/**
 * Paint the OS-region hero for systems with no installer (Linux / mobile / unknown).
 * Windows and macOS keep the default static hero; their #action-slot carries the
 * download button or fallback.
 *
 * @param {"windows"|"macos"|"other"} os
 * @param {Document} doc
 */
function applyOsRegion(os, doc) {
  const osRegion = doc.getElementById("os-region");
  if (!osRegion) return;

  if (os !== "windows" && os !== "macos") {
    osRegion.innerHTML =
      `<h1>Pace IAS Pronunciation Practice</h1>` +
      `<p class="subtitle">English language practice for everyday life</p>` +
      `<p class="os-notice">` +
        `There is no download for your system. Installers are available for ` +
        `Windows and macOS — please use one of those, or contact the Pace IAS office.` +
      `</p>` +
      `<p><a href="${RELEASES_URL}" class="releases-link">See all downloads</a></p>`;
  }
}

/**
 * Show only the install instructions that match the detected OS.
 * Elements tagged with data-os="windows" / data-os="macos" are shown when their
 * value equals `os` and hidden otherwise. For systems with no installer, all
 * OS-specific blocks are hidden and a short explanatory note is prepended.
 *
 * @param {"windows"|"macos"|"other"} os
 * @param {Document} doc
 */
function applyInstructionsForOS(os, doc) {
  const instructions = doc.getElementById("instructions");
  if (!instructions) return;

  instructions.querySelectorAll("[data-os]").forEach((el) => {
    el.hidden = el.getAttribute("data-os") !== os;
  });

  if (os !== "windows" && os !== "macos") {
    const notice = doc.createElement("p");
    notice.className = "os-notice";
    notice.textContent =
      "Installers are available for Windows and macOS. There isn't one for your current system.";
    instructions.prepend(notice);
  }
}

/**
 * Main entry point — runs on DOMContentLoaded in the browser.
 * Detects OS synchronously, paints the hero and instructions, then fetches the
 * release and applies the resulting view (catching errors into the fetchFailed path).
 *
 * Exported for testing the wiring logic in isolation if needed.
 */
export async function init() {
  const os = detectOS();

  // Paint OS-dependent surfaces synchronously, before the fetch resolves.
  applyOsRegion(os, document);
  applyInstructionsForOS(os, document);

  // Pre-fetch fallback in the action slot while the request is in flight.
  if (os === "windows" || os === "macos") {
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
