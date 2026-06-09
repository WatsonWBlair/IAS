/**
 * app.js — Pace IAS Pronunciation Practice download page logic
 *
 * Loadable as a browser ES module (<script type="module">) and by
 * Node's built-in test runner ("node --test").
 *
 * Exports (pure, Node-safe):
 *   detectOS, pickWindowsInstaller, pickMacInstaller, fetchReleases,
 *   parseArchiveTag, compareSemver, selectLatestArchive, chooseAction
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
 * Fetch the repo's release LIST and normalize each entry.
 *
 * Resolution moved from `/releases/latest` to the full list because per-platform
 * release channels (#101) create every release `--latest=false`, freezing
 * `/releases/latest` at the legacy combined `app-v0.2.2`. The current installers
 * live on the per-platform archive tags (`app-v<ver>-win` / `app-v<ver>-mac`),
 * which `selectLatestArchive` picks out of this list. We list via api.github.com
 * (which sends `Access-Control-Allow-Origin: *`) rather than reading the channel
 * `latest.json` asset, whose host sends no CORS header (so an in-browser fetch
 * of it is rejected).
 *
 * @param {string} repoUrl - GitHub API list URL, e.g.
 *   "https://api.github.com/repos/WatsonWBlair/IAS/releases?per_page=100"
 * Carries each release's `prerelease`/`draft` flags through so `selectLatestArchive`
 * can skip not-ready builds (a prerelease is visible to an unauthenticated fetch and
 * would otherwise outrank the newest stable archive).
 *
 * @param {function} [fetchFn] - Injectable fetch implementation; defaults to
 *   the global `fetch` when not supplied (browser / Node 18+).
 * @returns {Promise<Array<{tag_name: string, prerelease: boolean, draft: boolean, assets: Array<{name: string, browser_download_url: string}>}>>}
 * @throws {Error} when the HTTP response is not ok (non-2xx).
 */
export async function fetchReleases(
  repoUrl = "https://api.github.com/repos/WatsonWBlair/IAS/releases?per_page=100",
  fetchFn = globalThis.fetch
) {
  const response = await fetchFn(repoUrl);

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} for ${repoUrl}`);
  }

  const data = await response.json();
  const list = Array.isArray(data) ? data : [];

  return list.map((release) => ({
    tag_name: release.tag_name,
    prerelease: release.prerelease === true,
    draft: release.draft === true,
    assets: (release.assets ?? []).map(({ name, browser_download_url }) => ({
      name,
      browser_download_url,
    })),
  }));
}

/**
 * Parse a per-platform archive release tag into its clean version and OS.
 *
 * Matches ONLY immutable archive tags of the exact form `app-v<MAJOR.MINOR.PATCH>-win`
 * or `…-mac`. Returns `null` for everything else — channel pointers (`win-stable`),
 * the speech-model releases (`model-v*`), the legacy combined `app-v0.2.2` (no
 * platform suffix), and any malformed tag. Pure.
 *
 * @param {string} tag
 * @returns {{version: string, platform: "windows"|"macos"} | null}
 */
export function parseArchiveTag(tag) {
  if (typeof tag !== "string") return null;
  const match = /^app-v(\d+\.\d+\.\d+)-(win|mac)$/.exec(tag);
  if (!match) return null;
  return {
    version: match[1],
    platform: match[2] === "win" ? "windows" : "macos",
  };
}

/**
 * Compare two `MAJOR.MINOR.PATCH` versions numerically.
 * Returns >0 when `a` is newer, <0 when older, 0 when equal.
 * Numeric per-component compare, so `0.2.10` sorts above `0.2.9`. Defensive:
 * invalid input never throws — a fully non-numeric or missing component parses
 * as 0 via the `parseInt` fallback. (In production only clean MAJOR.MINOR.PATCH
 * strings from `parseArchiveTag` reach this; a hyphenated pre-release patch like
 * `3-beta` would `parseInt` to its numeric prefix — pre-release ordering is out
 * of scope per the channel-resolution design.)
 * Pure.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * From a normalized release list, pick the newest per-platform archive for `os`.
 *
 * Pure — no DOM, no fetch. Returns a release-shaped object
 * (`{version: <clean semver>, assets}`) that `chooseAction` consumes unchanged,
 * or `null` when no archive matches `os` (caller treats null as "not resolvable"
 * → graceful fallback). `version` is already the clean, suffix-stripped semver,
 * suitable to pass straight to the changelog's `selectNotes`.
 *
 * Skips any release flagged `prerelease` or `draft` even when its semver is
 * highest — a learner must never be handed a not-ready build.
 *
 * @param {Array<{tag_name: string, prerelease?: boolean, draft?: boolean, assets: Array}>} releases
 * @param {"windows"|"macos"|"other"} os
 * @returns {{version: string, assets: Array<{name: string, browser_download_url: string}>} | null}
 */
export function selectLatestArchive(releases, os) {
  if (!Array.isArray(releases)) return null;
  if (os !== "windows" && os !== "macos") return null;

  let best = null;
  for (const release of releases) {
    const parsed = parseArchiveTag(release && release.tag_name);
    if (!parsed || parsed.platform !== os) continue;
    // Never offer a not-ready build: skip prereleases/drafts even if their semver
    // outranks the newest stable archive. (Drafts are invisible to unauthenticated
    // fetches anyway; prereleases are visible, so this is the live guard.)
    if (release.prerelease === true || release.draft === true) continue;
    if (best === null || compareSemver(parsed.version, best.version) > 0) {
      best = {
        version: parsed.version,
        assets: Array.isArray(release.assets) ? release.assets : [],
      };
    }
  }
  return best;
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

// Full releases list (NOT /releases/latest, which #101 froze at app-v0.2.2):
// the fallback must land a learner on a page that shows the current version.
const RELEASES_URL = "https://github.com/WatsonWBlair/IAS/releases";
// per_page=100: the API returns releases newest-first, so the newest per-platform
// archive is always on page 1 — a single page suffices, no pagination needed.
const RELEASES_API_URL =
  "https://api.github.com/repos/WatsonWBlair/IAS/releases?per_page=100";

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
 * Detects OS synchronously, paints the hero and instructions, then lists the
 * releases, resolves the newest per-platform archive, and applies the resulting
 * view (catching errors — and an unresolvable result — into the fallback path).
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

  // List releases, resolve the newest per-platform archive, apply the real view.
  // `selectLatestArchive` returns null when no archive matches this OS; passing
  // that null through `chooseAction` yields the same graceful fallback as a fetch
  // error, so the page never shows a dead button.
  try {
    const releases = await fetchReleases(RELEASES_API_URL);
    const release = selectLatestArchive(releases, os);
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
