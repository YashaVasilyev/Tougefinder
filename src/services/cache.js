import { get, set, clear, keys } from 'idb-keyval';

/**
 * Persistent Cache Service for OSM data
 * Uses IndexedDB to store large datasets indefinitely
 */

const CACHE_PREFIX = 'touge_cache_';

export const getCachedRoads = async (lat, lon, radius) => {
  const key = generateKey(lat, lon, radius);
  return await get(key);
};

export const cacheRoads = async (lat, lon, radius, roads) => {
  const key = generateKey(lat, lon, radius);
  await set(key, roads);
};

export const clearAppCache = async () => {
  await clear();
};

export const getCacheSize = async () => {
  const allKeys = await keys();
  return allKeys.length;
};

// Simple spatial keying (rounded to 2 decimal places ~1.1km precision)
const generateKey = (lat, lon, radius) => {
  const rLat = Math.round(lat * 50) / 50; // ~2km grid
  const rLon = Math.round(lon * 50) / 50;
  return `${CACHE_PREFIX}${rLat}_${rLon}_${radius}`;
};
