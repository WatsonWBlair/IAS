/**
 * app.test.js — unit tests for app.js
 *
 * Run with: node --test
 * No external dependencies required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectOS,
  pickWindowsInstaller,
  pickMacInstaller,
  fetchReleases,
  parseArchiveTag,
  compareSemver,
  selectLatestArchive,
  chooseAction,
} from "./app.js";

// ─── detectOS ───────────────────────────────────────────────────────────────

describe("detectOS", () => {
  it("classifies a Windows 10 user-agent as windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    assert.equal(detectOS(ua), "windows");
  });

  it("classifies a Windows 11 user-agent as windows", () => {
    // Windows 11 still reports NT 10.0 in the UA string
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0";
    assert.equal(detectOS(ua), "windows");
  });

  it("classifies a macOS user-agent as macos", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    assert.equal(detectOS(ua), "macos");
  });

  it("classifies an iOS (iPhone) user-agent as other, not macos", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    assert.equal(detectOS(ua), "other");
  });

  it("classifies an iOS (iPad) user-agent as other", () => {
    // This UA contains the literal 'iPad' token, so the iOS guard fires.
    // An iPad in "Request Desktop Site" mode omits that token entirely and
    // sends 'Macintosh' instead — that case is classified as "macos", so it is
    // offered the macOS download (which an iPad cannot run). That is a rare
    // edge case and the macOS install steps make the intended target clear.
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    assert.equal(detectOS(ua), "other");
  });

  it("returns other when called with no argument in a Node environment (navigator undefined)", () => {
    // In Node, navigator is undefined; detectOS() must not throw and must
    // return "other" (empty UA string matches no known OS token).
    assert.equal(detectOS(), "other");
  });

  it("classifies an Android user-agent as other", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";
    assert.equal(detectOS(ua), "other");
  });

  it("classifies a Linux desktop user-agent as other", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    assert.equal(detectOS(ua), "other");
  });
});

// ─── pickWindowsInstaller ───────────────────────────────────────────────────

describe("pickWindowsInstaller", () => {
  const msiAsset = {
    name: "Global.Pathways_0.2.0_x64_en-US.msi",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/Global.Pathways_0.2.0_x64_en-US.msi",
  };
  const dmgAsset = {
    name: "Global.Pathways_0.2.0_x64.dmg",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/Global.Pathways_0.2.0_x64.dmg",
  };
  const latestJsonAsset = {
    name: "latest.json",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/latest.json",
  };
  const onnxAsset = {
    name: "model-v2.onnx",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/model-v2.onnx",
  };

  it("returns the .msi asset from a list containing only the installer", () => {
    const result = pickWindowsInstaller([msiAsset]);
    assert.deepEqual(result, msiAsset);
  });

  it("returns null when the list contains only a .dmg", () => {
    assert.equal(pickWindowsInstaller([dmgAsset]), null);
  });

  it("returns null for an empty asset list", () => {
    assert.equal(pickWindowsInstaller([]), null);
  });

  it("picks the .msi from a realistic mixed list (.msi + latest.json + .onnx)", () => {
    const result = pickWindowsInstaller([latestJsonAsset, msiAsset, onnxAsset]);
    assert.deepEqual(result, msiAsset);
  });

  it("returns the first .msi when multiple .msi assets are present", () => {
    const secondMsi = { name: "Other_0.2.0_x64.msi", browser_download_url: "https://example.com/other.msi" };
    const result = pickWindowsInstaller([msiAsset, secondMsi]);
    assert.deepEqual(result, msiAsset);
  });

  it("returns null when the list contains only a .dmg (no .msi)", () => {
    assert.equal(pickWindowsInstaller([dmgAsset]), null);
  });
});

// ─── pickMacInstaller ─────────────────────────────────────────────────────────

describe("pickMacInstaller", () => {
  const dmgAsset = {
    name: "PaceIAS_0.2.0_aarch64.dmg",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/PaceIAS_0.2.0_aarch64.dmg",
  };
  const msiAsset = {
    name: "PaceIAS_0.2.0_x64_en-US.msi",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/PaceIAS_0.2.0_x64_en-US.msi",
  };
  const latestJsonAsset = {
    name: "latest.json",
    browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/latest.json",
  };

  it("returns the .dmg asset from a list containing only the disk image", () => {
    assert.deepEqual(pickMacInstaller([dmgAsset]), dmgAsset);
  });

  it("returns null when the list contains only a .msi (no .dmg)", () => {
    assert.equal(pickMacInstaller([msiAsset]), null);
  });

  it("returns null for an empty asset list", () => {
    assert.equal(pickMacInstaller([]), null);
  });

  it("picks the .dmg from a realistic mixed list (.msi + .dmg + latest.json)", () => {
    assert.deepEqual(pickMacInstaller([msiAsset, latestJsonAsset, dmgAsset]), dmgAsset);
  });
});

// ─── fetchReleases ──────────────────────────────────────────────────────────

describe("fetchReleases", () => {
  /** Build a minimal fake fetch that returns the supplied data with ok:true */
  function fakeFetch(payload, { status = 200, ok = true } = {}) {
    return async (_url) => ({
      ok,
      status,
      json: async () => payload,
    });
  }

  const sampleListResponse = [
    {
      tag_name: "app-v0.2.3-win",
      body: "ignored by the normalizer",
      assets: [
        {
          name: "P3.Platform_0.2.3_x64_en-US.msi",
          browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/app-v0.2.3-win/P3.Platform_0.2.3_x64_en-US.msi",
          // extra fields the normalizer should discard
          size: 12345678,
          download_count: 42,
        },
      ],
    },
    {
      tag_name: "win-stable",
      assets: [
        {
          name: "latest.json",
          browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/win-stable/latest.json",
          size: 256,
        },
      ],
    },
  ];

  it("returns an array, normalizing tag_name + asset {name, browser_download_url} only", async () => {
    const result = await fetchReleases("https://api.example.com/releases", fakeFetch(sampleListResponse));

    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);

    const [archive] = result;
    assert.equal(archive.tag_name, "app-v0.2.3-win");
    assert.equal(archive.assets.length, 1);
    assert.equal(archive.assets[0].name, "P3.Platform_0.2.3_x64_en-US.msi");
    assert.ok(archive.assets[0].browser_download_url.endsWith(".msi"));
    // extra fields stripped
    assert.equal(archive.assets[0].size, undefined);
    assert.equal(archive.assets[0].download_count, undefined);
  });

  it("carries prerelease/draft flags, defaulting absent flags to false", async () => {
    const payload = [
      { tag_name: "app-v0.3.0-win", prerelease: true, draft: false, assets: [] },
      { tag_name: "app-v0.2.3-win", assets: [] }, // flags absent
    ];
    const result = await fetchReleases("https://api.example.com/releases", fakeFetch(payload));
    assert.equal(result[0].prerelease, true);
    assert.equal(result[0].draft, false);
    // absent flags normalize to false, never undefined
    assert.equal(result[1].prerelease, false);
    assert.equal(result[1].draft, false);
  });

  it("handles a release with no assets key (→ empty assets array)", async () => {
    const result = await fetchReleases(
      "https://api.example.com/releases",
      fakeFetch([{ tag_name: "app-v0.1.0-win" /* no assets key */ }])
    );
    assert.deepEqual(result[0].assets, []);
  });

  it("returns an empty array when the payload is not an array", async () => {
    // The /releases LIST endpoint returns an array; a non-array (e.g. a rate-limit
    // object) must degrade to [] rather than crash the resolver.
    const result = await fetchReleases("https://api.example.com/releases", fakeFetch({ message: "rate limited" }));
    assert.deepEqual(result, []);
  });

  it("throws when the API returns a non-200 status (404)", async () => {
    const notFoundFetch = fakeFetch([], { status: 404, ok: false });
    await assert.rejects(
      () => fetchReleases("https://api.example.com/releases", notFoundFetch),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("404"), `expected '404' in: ${err.message}`);
        return true;
      }
    );
  });

  it("throws when the API returns a 500 status", async () => {
    const serverErrorFetch = fakeFetch([], { status: 500, ok: false });
    await assert.rejects(
      () => fetchReleases("https://api.example.com/releases", serverErrorFetch),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("500"), `expected '500' in: ${err.message}`);
        return true;
      }
    );
  });

  it("does not make a real network call (fake fetch receives the url argument)", async () => {
    let capturedUrl = null;
    const capturingFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => [] };
    };

    await fetchReleases("https://api.example.com/test-url", capturingFetch);
    assert.equal(capturedUrl, "https://api.example.com/test-url");
  });
});

// ─── parseArchiveTag ──────────────────────────────────────────────────────────

describe("parseArchiveTag", () => {
  it("parses a Windows archive tag → clean version + windows", () => {
    assert.deepEqual(parseArchiveTag("app-v0.2.3-win"), { version: "0.2.3", platform: "windows" });
  });

  it("parses a macOS archive tag → clean version + macos", () => {
    assert.deepEqual(parseArchiveTag("app-v0.2.3-mac"), { version: "0.2.3", platform: "macos" });
  });

  it("rejects a channel pointer tag (win-stable)", () => {
    assert.equal(parseArchiveTag("win-stable"), null);
    assert.equal(parseArchiveTag("mac-stable"), null);
  });

  it("rejects the legacy combined tag with no platform suffix (app-v0.2.2)", () => {
    assert.equal(parseArchiveTag("app-v0.2.2"), null);
  });

  it("rejects a speech-model tag (model-v0.1.0)", () => {
    assert.equal(parseArchiveTag("model-v0.1.0"), null);
  });

  it("rejects malformed / unknown-suffix / non-string input", () => {
    assert.equal(parseArchiveTag("app-v0.2.3-linux"), null);
    assert.equal(parseArchiveTag("app-vX.Y.Z-win"), null);
    assert.equal(parseArchiveTag("app-v0.2-win"), null); // not MAJOR.MINOR.PATCH
    assert.equal(parseArchiveTag(""), null);
    assert.equal(parseArchiveTag(null), null);
    assert.equal(parseArchiveTag(undefined), null);
    assert.equal(parseArchiveTag(123), null);
  });
});

// ─── compareSemver ────────────────────────────────────────────────────────────

describe("compareSemver", () => {
  it("orders patch numerically, not lexically (0.2.10 > 0.2.9)", () => {
    assert.ok(compareSemver("0.2.10", "0.2.9") > 0);
    assert.ok(compareSemver("0.2.9", "0.2.10") < 0);
  });

  it("returns 0 for equal versions", () => {
    assert.equal(compareSemver("1.2.3", "1.2.3"), 0);
  });

  it("orders major and minor", () => {
    assert.ok(compareSemver("1.0.0", "0.9.9") > 0);
    assert.ok(compareSemver("0.3.0", "0.2.9") > 0);
  });

  it("does not throw on a pre-release/garbage component (parses as 0)", () => {
    assert.doesNotThrow(() => compareSemver("0.2.3-beta.1", "0.2.3"));
    assert.doesNotThrow(() => compareSemver("x.y.z", "0.0.0"));
  });
});

// ─── selectLatestArchive ──────────────────────────────────────────────────────

describe("selectLatestArchive", () => {
  // A realistic mixed listing: two platform archives, the channel pointers,
  // the legacy combined release, and the speech model — newest-first as the API returns.
  const winMsi = (v) => ({
    name: `P3.Platform_${v}_x64_en-US.msi`,
    browser_download_url: `https://github.com/WatsonWBlair/IAS/releases/download/app-v${v}-win/P3.Platform_${v}_x64_en-US.msi`,
  });
  const macDmg = (v) => ({
    name: `P3.Platform_${v}_aarch64.dmg`,
    browser_download_url: `https://github.com/WatsonWBlair/IAS/releases/download/app-v${v}-mac/P3.Platform_${v}_aarch64.dmg`,
  });

  const listing = [
    { tag_name: "mac-stable", assets: [{ name: "latest.json", browser_download_url: "https://github.com/x/y/releases/download/mac-stable/latest.json" }] },
    { tag_name: "app-v0.2.3-mac", assets: [macDmg("0.2.3")] },
    { tag_name: "win-stable", assets: [{ name: "latest.json", browser_download_url: "https://github.com/x/y/releases/download/win-stable/latest.json" }] },
    { tag_name: "app-v0.2.3-win", assets: [winMsi("0.2.3")] },
    { tag_name: "app-v0.2.1-win", assets: [winMsi("0.2.1")] },
    { tag_name: "app-v0.2.2", assets: [winMsi("0.2.2")] }, // legacy combined — ignored
    { tag_name: "model-v0.1.0", assets: [{ name: "ias-model-0.1.0.onnx", browser_download_url: "https://github.com/x/y/releases/download/model-v0.1.0/ias-model-0.1.0.onnx" }] },
  ];

  it("picks the newest Windows archive, returning clean version + its assets", () => {
    const result = selectLatestArchive(listing, "windows");
    assert.equal(result.version, "0.2.3");
    assert.deepEqual(result.assets, [winMsi("0.2.3")]);
  });

  it("picks the newest macOS archive", () => {
    const result = selectLatestArchive(listing, "macos");
    assert.equal(result.version, "0.2.3");
    assert.deepEqual(result.assets, [macDmg("0.2.3")]);
  });

  it("selects by semver, not list order (out-of-order list still yields the newest)", () => {
    const shuffled = [
      { tag_name: "app-v0.2.1-win", assets: [winMsi("0.2.1")] },
      { tag_name: "app-v0.2.10-win", assets: [winMsi("0.2.10")] },
      { tag_name: "app-v0.2.9-win", assets: [winMsi("0.2.9")] },
    ];
    assert.equal(selectLatestArchive(shuffled, "windows").version, "0.2.10");
  });

  it("returns null when no archive matches the OS (macOS absent)", () => {
    const winOnly = [{ tag_name: "app-v0.2.3-win", assets: [winMsi("0.2.3")] }];
    assert.equal(selectLatestArchive(winOnly, "macos"), null);
  });

  it("returns null for an empty list, a non-array, and an unsupported OS", () => {
    assert.equal(selectLatestArchive([], "windows"), null);
    assert.equal(selectLatestArchive(null, "windows"), null);
    assert.equal(selectLatestArchive(listing, "other"), null);
  });

  it("tolerates entries with a missing/blank tag or assets without throwing", () => {
    const messy = [
      {},
      { tag_name: null },
      { tag_name: "app-v0.2.3-win" }, // no assets key
    ];
    const result = selectLatestArchive(messy, "windows");
    assert.equal(result.version, "0.2.3");
    assert.deepEqual(result.assets, []);
  });

  it("skips a higher-semver prerelease archive (never serves a not-ready build)", () => {
    const list = [
      { tag_name: "app-v0.3.0-win", prerelease: true, assets: [winMsi("0.3.0")] },
      { tag_name: "app-v0.2.3-win", prerelease: false, assets: [winMsi("0.2.3")] },
    ];
    const result = selectLatestArchive(list, "windows");
    assert.equal(result.version, "0.2.3");
    assert.deepEqual(result.assets, [winMsi("0.2.3")]);
  });

  it("skips a draft archive even when it is the only candidate (→ null)", () => {
    const list = [{ tag_name: "app-v0.3.0-win", draft: true, assets: [winMsi("0.3.0")] }];
    assert.equal(selectLatestArchive(list, "windows"), null);
  });
});

// ─── chooseAction ────────────────────────────────────────────────────────────

describe("chooseAction", () => {
  const msiAsset = {
    name: "Global.Pathways_0.2.0_x64_en-US.msi",
    browser_download_url: "https://github.com/example/releases/download/v0.2.0/installer.msi",
  };
  const onnxAsset = {
    name: "model-v2.onnx",
    browser_download_url: "https://github.com/example/releases/download/v0.2.0/model-v2.onnx",
  };

  // ── Windows + .msi present → download ──────────────────────────

  it("returns kind:download when Windows and a .msi asset is present", () => {
    const release = { version: "v0.2.0", notes: "", assets: [msiAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "download");
    assert.equal(view.href, msiAsset.browser_download_url);
    // v-prefix is stripped for display
    assert.equal(view.version, "0.2.0");
  });

  it("strips app-v prefix from tag_name in the download view's version (e.g. app-v0.2.0 → 0.2.0)", () => {
    const trustedAsset = {
      name: "installer.msi",
      browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/app-v0.2.0/installer.msi",
    };
    const release = { version: "app-v0.2.0", notes: "", assets: [trustedAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "download");
    assert.equal(view.version, "0.2.0");
  });

  it("leaves a bare version string unchanged in the download view (e.g. 0.2.0 → 0.2.0)", () => {
    const trustedAsset = {
      name: "installer.msi",
      browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/0.2.0/installer.msi",
    };
    const release = { version: "0.2.0", notes: "", assets: [trustedAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "download");
    assert.equal(view.version, "0.2.0");
  });

  // ── Windows + fetch success + no .msi → notPublished ───────────

  it("returns kind:notPublished when Windows but no .msi in assets", () => {
    const release = { version: "model-v2", notes: "", assets: [onnxAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "notPublished");
  });

  it("returns kind:notPublished when Windows and asset list is empty", () => {
    const release = { version: "v0.1.0", notes: "", assets: [] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "notPublished");
  });

  // ── Windows + fetch error → fetchFailed ────────────────────────

  it("returns kind:fetchFailed when Windows and releaseOrError is an Error", () => {
    const view = chooseAction("windows", new Error("GitHub API returned 403"));
    assert.equal(view.kind, "fetchFailed");
  });

  it("returns kind:fetchFailed when Windows and releaseOrError is null (pre-fetch)", () => {
    const view = chooseAction("windows", null);
    assert.equal(view.kind, "fetchFailed");
  });

  // ── macOS download / not-published (parallels Windows) ─────────

  const dmgAsset = {
    name: "PaceIAS_0.2.0_aarch64.dmg",
    browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/app-v0.2.0/PaceIAS_0.2.0_aarch64.dmg",
  };

  it("returns kind:download (os macos) when macOS and a trusted .dmg is present", () => {
    const release = { version: "app-v0.2.0", notes: "", assets: [dmgAsset] };
    const view = chooseAction("macos", release);
    assert.equal(view.kind, "download");
    assert.equal(view.os, "macos");
    assert.equal(view.href, dmgAsset.browser_download_url);
    assert.equal(view.version, "0.2.0");
  });

  it("returns kind:notPublished (os macos) when macOS but only a .msi is present (no .dmg)", () => {
    const release = { version: "app-v0.2.0", notes: "", assets: [msiAsset] };
    const view = chooseAction("macos", release);
    assert.equal(view.kind, "notPublished");
    assert.equal(view.os, "macos");
  });

  it("picks the .dmg for macOS even when a .msi is also present", () => {
    const release = { version: "v0.2.0", notes: "", assets: [msiAsset, dmgAsset] };
    const view = chooseAction("macos", release);
    assert.equal(view.kind, "download");
    assert.equal(view.href, dmgAsset.browser_download_url);
  });

  it("returns kind:notPublished when the macOS .dmg URL is not from a trusted GitHub origin", () => {
    const untrustedDmg = { name: "app.dmg", browser_download_url: "https://evil.example/app.dmg" };
    const release = { version: "v0.2.0", notes: "", assets: [untrustedDmg] };
    const view = chooseAction("macos", release);
    assert.equal(view.kind, "notPublished");
    assert.equal(view.os, "macos");
  });

  it("returns kind:fetchFailed when macOS and releaseOrError is an Error", () => {
    assert.equal(chooseAction("macos", new Error("offline")).kind, "fetchFailed");
  });

  it("returns kind:fetchFailed when macOS and releaseOrError is null (pre-fetch)", () => {
    assert.equal(chooseAction("macos", null).kind, "fetchFailed");
  });

  // ── other (Linux/mobile/unknown) → unsupported ─────────────────

  it("returns kind:unsupported for other (Linux/Android/mobile) regardless of release state", () => {
    const view = chooseAction("other", new Error("offline"));
    assert.equal(view.kind, "unsupported");
    assert.equal(view.os, "other");
  });

  it("returns kind:unsupported for other even when a .dmg/.msi is present (no installer offered)", () => {
    const release = { version: "v0.2.0", notes: "", assets: [msiAsset, dmgAsset] };
    const view = chooseAction("other", release);
    assert.equal(view.kind, "unsupported");
    assert.equal(view.os, "other");
  });

  // ── Origin allowlist: untrusted .msi URL → notPublished ──────────

  it("returns kind:notPublished when the .msi URL is not from a trusted GitHub origin", () => {
    const untrustedAsset = {
      name: "installer.msi",
      browser_download_url: "https://evil.example/x.msi",
    };
    const release = { version: "v0.2.0", notes: "", assets: [untrustedAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "notPublished");
  });

  it("returns kind:download when the .msi URL starts with https://github.com/ (trusted origin)", () => {
    const trustedAsset = {
      name: "installer.msi",
      browser_download_url: "https://github.com/WatsonWBlair/IAS/releases/download/v1.0.0/installer.msi",
    };
    const release = { version: "v1.0.0", notes: "", assets: [trustedAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "download");
    assert.equal(view.href, trustedAsset.browser_download_url);
  });

  it("returns kind:download when the .msi URL starts with https://objects.githubusercontent.com/ (trusted origin)", () => {
    const trustedAsset = {
      name: "installer.msi",
      browser_download_url: "https://objects.githubusercontent.com/github-production-release-asset-2e65be/installer.msi",
    };
    const release = { version: "v1.0.0", notes: "", assets: [trustedAsset] };
    const view = chooseAction("windows", release);
    assert.equal(view.kind, "download");
    assert.equal(view.href, trustedAsset.browser_download_url);
  });
});
