import { LocalStorage } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { RunningApp } from "./types";

// Batch app properties + window names + resolve paths via NSWorkspace.
// Skips AXMinimized (expensive) -- phase 2 handles that in background.
const FAST_SCRIPT = `(() => {
  ObjC.import("AppKit");
  var ws = $.NSWorkspace.sharedWorkspace;
  var se = Application("System Events");
  var procs = se.processes.whose({ backgroundOnly: false });
  var names = procs.name();
  var bundleIds = procs.bundleIdentifier();
  var frontmosts = procs.frontmost();
  var count = names.length;

  var allWinNames = null;
  try { allWinNames = procs.windows.name(); } catch(e) {}

  var results = [];
  for (var i = 0; i < count; i++) {
    if (!bundleIds[i]) continue;

    var path = "";
    try {
      var url = ws.URLForApplicationWithBundleIdentifier(bundleIds[i]);
      if (url && url.path) path = ObjC.unwrap(url.path);
    } catch(e) {}

    var wn;
    if (allWinNames !== null) {
      wn = allWinNames[i] || [];
    } else {
      try { wn = procs[i].windows.name(); } catch(e) { wn = []; }
    }
    var windows = [];
    for (var j = 0; j < wn.length; j++) {
      windows.push({ title: wn[j] || "", minimized: false, index: j });
    }
    results.push({
      name: names[i],
      bundleId: bundleIds[i],
      frontmost: frontmosts[i],
      appPath: path,
      windows: windows
    });
  }
  return JSON.stringify(results);
})()`;

// Phase 2: per-process batch AXMinimized. Returns { bundleId: [bool, bool, ...] }.
const MINIMIZED_SCRIPT = `(() => {
  var se = Application("System Events");
  var procs = se.processes.whose({ backgroundOnly: false });
  var bundleIds = procs.bundleIdentifier();
  var count = bundleIds.length;
  var result = {};

  for (var i = 0; i < count; i++) {
    if (!bundleIds[i]) continue;
    try {
      var vals = procs[i].windows.attributes.byName("AXMinimized").value();
      if (vals && vals.length > 0) {
        var arr = [];
        for (var j = 0; j < vals.length; j++) arr.push(vals[j] === true);
        result[bundleIds[i]] = arr;
      }
    } catch(e) {}
  }
  return JSON.stringify(result);
})()`;

const RUNNING_APPS_CACHE_KEY = "runningAppsCache";
const RUNNING_APPS_CACHE_TTL_MS = 20_000;

interface RunningAppsCacheEntry {
  timestamp: number;
  apps: RunningApp[];
}

export async function getRunningApps(): Promise<RunningApp[]> {
  const result = await runAppleScript(FAST_SCRIPT, { language: "JavaScript" });
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

export async function getCachedRunningApps(): Promise<RunningApp[] | null> {
  const stored = await LocalStorage.getItem<string>(RUNNING_APPS_CACHE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as RunningAppsCacheEntry;
    if (
      !parsed ||
      typeof parsed.timestamp !== "number" ||
      !Array.isArray(parsed.apps)
    ) {
      return null;
    }
    const isExpired = Date.now() - parsed.timestamp > RUNNING_APPS_CACHE_TTL_MS;
    if (isExpired) return null;
    return parsed.apps;
  } catch {
    return null;
  }
}

export async function setCachedRunningApps(apps: RunningApp[]): Promise<void> {
  const payload: RunningAppsCacheEntry = {
    timestamp: Date.now(),
    apps,
  };
  await LocalStorage.setItem(RUNNING_APPS_CACHE_KEY, JSON.stringify(payload));
}

export async function getMinimizedStatus(): Promise<Record<string, boolean[]>> {
  const result = await runAppleScript(MINIMIZED_SCRIPT, {
    language: "JavaScript",
  });
  try {
    return JSON.parse(result);
  } catch {
    return {};
  }
}
