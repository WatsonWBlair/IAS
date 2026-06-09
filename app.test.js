/**
 * app.test.js — unit tests for app.js
 *
 * Run with: node --test
 * No external dependencies required.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectOS, pickWindowsInstaller, fetchLatestRelease } from "./app.js";

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
    // sends 'Macintosh' instead — that case is classified as "macos", which
    // is acceptable because both "macos" and "other" reach the same
    // "no build for your system" state.
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
});

// ─── fetchLatestRelease ─────────────────────────────────────────────────────

describe("fetchLatestRelease", () => {
  /** Build a minimal fake fetch that returns the supplied data with ok:true */
  function fakeFetch(payload, { status = 200, ok = true } = {}) {
    return async (_url) => ({
      ok,
      status,
      json: async () => payload,
    });
  }

  const sampleApiResponse = {
    tag_name: "app-v0.2.0",
    body: "First public release.",
    assets: [
      {
        name: "Global.Pathways_0.2.0_x64_en-US.msi",
        browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/Global.Pathways_0.2.0_x64_en-US.msi",
        // extra fields that the normalizer should discard
        size: 12345678,
        download_count: 42,
      },
      {
        name: "latest.json",
        browser_download_url: "https://github.com/example/releases/download/app-v0.2.0/latest.json",
        size: 256,
        download_count: 99,
      },
    ],
  };

  it("normalizes tag_name → version, body → notes, and trims asset fields", async () => {
    const result = await fetchLatestRelease("https://api.example.com/releases/latest", fakeFetch(sampleApiResponse));

    assert.equal(result.version, "app-v0.2.0");
    assert.equal(result.notes, "First public release.");
    assert.equal(result.assets.length, 2);

    const [msi, json] = result.assets;
    assert.equal(msi.name, "Global.Pathways_0.2.0_x64_en-US.msi");
    assert.ok(msi.browser_download_url.endsWith(".msi"));
    // extra fields should NOT be present on normalized assets
    assert.equal(msi.size, undefined);
    assert.equal(msi.download_count, undefined);

    assert.equal(json.name, "latest.json");
  });

  it("handles a release with no assets (assets array absent)", async () => {
    const result = await fetchLatestRelease(
      "https://api.example.com/releases/latest",
      fakeFetch({ tag_name: "app-v0.1.0", body: "early", /* no assets key */ })
    );
    assert.deepEqual(result.assets, []);
  });

  it("throws when the API returns a non-200 status", async () => {
    const notFoundFetch = fakeFetch({}, { status: 404, ok: false });
    await assert.rejects(
      () => fetchLatestRelease("https://api.example.com/releases/latest", notFoundFetch),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("404"), `expected '404' in: ${err.message}`);
        return true;
      }
    );
  });

  it("throws when the API returns a 500 status", async () => {
    const serverErrorFetch = fakeFetch({}, { status: 500, ok: false });
    await assert.rejects(
      () => fetchLatestRelease("https://api.example.com/releases/latest", serverErrorFetch),
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
      return { ok: true, status: 200, json: async () => ({ tag_name: "v1", body: "", assets: [] }) };
    };

    await fetchLatestRelease("https://api.example.com/test-url", capturingFetch);
    assert.equal(capturedUrl, "https://api.example.com/test-url");
  });
});
