import { get, set, keys, del } from 'idb-keyval';

/**
 * Service to handle persistent caching of road search results
 */

// Round coordinates to a grid to increase cache hit rate (approx 1.1km grid)
const roundToGrid = (num) => Math.round(num * 100) / 100;

export const getCachedRoads = async (lat, lon, radius, thresholds) => {
  const key = `roads_${roundToGrid(lat)}_${roundToGrid(lon)}_${radius}_${JSON.stringify(thresholds)}`;
  try {
    const cached = await get(key);
    if (cached && (Date.now() - cached.timestamp < 1000 * 60 * 60 * 24 * 7)) { // 7 days cache
      console.log('Cache hit for:', key);
      return cached.data;
    }
    return null;
  } catch (err) {
    console.error('Cache read error:', err);
    return null;
  }
};

export const saveToCache = async (lat, lon, radius, thresholds, data) => {
  const key = `roads_${roundToGrid(lat)}_${roundToGrid(lon)}_${radius}_${JSON.stringify(thresholds)}`;
  try {
    await set(key, {
      timestamp: Date.now(),
      data: data
    });
    console.log('Saved to cache:', key);
    
    // Cleanup old cache entries if needed (keep latest 50 searches)
    const allKeys = await keys();
    if (allKeys.length > 50) {
      const sortedKeys = allKeys.filter(k => k.startsWith('roads_')).sort();
      for (let i = 0; i < sortedKeys.length - 50; i++) {
        await del(sortedKeys[i]);
      }
    }
  } catch (err) {
    console.error('Cache write error:', err);
  }
};
