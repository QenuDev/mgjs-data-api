// src/core/game/versionStorage.js

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../..", "data");
const VERSION_FILE = path.join(DATA_DIR, "version.json");
const STORED_VERSION_TTL = 60 * 1000; // 1 min

let cachedStoredVersion = null;
let cachedStoredAt = 0;
let cachedGeneratedAt = null;

/**
 * Ensure data directory exists.
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // Already exists or permission error will be caught later
  }
}

/**
 * Load the stored version record: the game version our datasets and sprites
 * were built from (`version`) and when that build last completed
 * (`lastUpdated`, written by saveVersion).
 *
 * Returns nulls if the file doesn't exist (first run).
 */
export async function loadStoredVersionInfo() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(VERSION_FILE, "utf-8");
    const data = JSON.parse(content);
    return {
      version: data.version || null,
      generatedAt: data.lastUpdated || null,
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      logger.debug("Version file not found (first run)");
      return { version: null, generatedAt: null };
    }
    logger.warn({ error: err.message }, "Failed to load stored version");
    return { version: null, generatedAt: null };
  }
}

/**
 * Load stored game version from disk.
 * Returns null if file doesn't exist (first run).
 */
export async function loadStoredVersion() {
  return (await loadStoredVersionInfo()).version;
}

/**
 * Load the stored version record with a short in-memory cache.
 */
export async function getStoredVersionInfoCached() {
  const now = Date.now();
  if (cachedStoredVersion && now - cachedStoredAt < STORED_VERSION_TTL) {
    return { version: cachedStoredVersion, generatedAt: cachedGeneratedAt };
  }

  const info = await loadStoredVersionInfo();
  if (info.version) {
    cachedStoredVersion = info.version;
    cachedGeneratedAt = info.generatedAt;
    cachedStoredAt = now;
  }

  return info;
}

/**
 * Load stored version with a short in-memory cache.
 */
export async function getStoredVersionCached() {
  return (await getStoredVersionInfoCached()).version;
}

/**
 * Save game version to disk.
 */
export async function saveVersion(version) {
  try {
    await ensureDataDir();
    const data = {
      version: String(version).trim(),
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(VERSION_FILE, JSON.stringify(data, null, 2));
    cachedStoredVersion = data.version;
    cachedGeneratedAt = data.lastUpdated;
    cachedStoredAt = Date.now();
    logger.info({ version: data.version }, "Version saved");
  } catch (err) {
    logger.error({ error: err.message }, "Failed to save version");
  }
}

/**
 * Check if game version has changed compared to stored version.
 * Saves new version if changed.
 */
export async function getVersionChanged(currentVersion) {
  const stored = await loadStoredVersion();
  const changed = stored !== currentVersion;

  if (changed && currentVersion) {
    await saveVersion(currentVersion);
    logger.warn({ from: stored, to: currentVersion }, "Game version changed");
  }

  return changed;
}
