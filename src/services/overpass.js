/**
 * Service to fetch road data from OpenStreetMap via Overpass API
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter'
];

export const fetchRoads = async (lat, lon, radiusKm = 10) => {
  const radiusMeters = radiusKm * 1000;
  let lastError = null;

  for (const baseUrl of MIRRORS) {
    const query = `
      [out:json][timeout:25];
      (
        way(around:${radiusMeters}, ${lat}, ${lon})[highway~"^(tertiary|unclassified|secondary|primary)$"];
        node(around:${radiusMeters}, ${lat}, ${lon})[highway=stop];
      );
      out body;
      >;
      out skel qt;
    `;

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `data=${encodeURIComponent(query)}`
      });

      if (!response.ok) continue;

      const data = await response.json();
      console.log(`Fetched from ${baseUrl}: ${data.elements.length} elements`);
      return processOverpassData(data);
    } catch (error) {
      lastError = error;
      console.warn(`Mirror ${baseUrl} failed, trying next...`);
    }
  }

  throw lastError || new Error('All Overpass mirrors timed out.');
};

/**
 * Convert Overpass JSON to a collection of road segments with coordinates
 */
const processOverpassData = (data) => {
  const nodes = new Map();
  const ways = [];
  const stopSigns = new Set();
  const nodeToWays = {};
  const majorWayIds = new Set();

  for (const el of data.elements) {
    if (el.type === 'node') {
      nodes.set(el.id, [el.lon, el.lat]);
      if (el.tags?.highway === 'stop') stopSigns.add(el.id);
    } else if (el.type === 'way' && el.nodes) {
      ways.push(el);
      const lanes = parseInt(el.tags?.lanes || '2');
      const isMajor = lanes >= 4 || ['motorway', 'trunk', 'primary'].includes(el.tags?.highway);
      if (isMajor) majorWayIds.add(el.id);

      for (const nodeId of el.nodes) {
        if (!nodeToWays[nodeId]) nodeToWays[nodeId] = [];
        nodeToWays[nodeId].push(el.id);
      }
    }
  }

  const wayMap = new Map(ways.map(w => [w.id, w]));
  const visitedWays = new Set();
  const mergedRoads = [];

  for (const way of ways) {
    if (visitedWays.has(way.id)) continue;

    let currentPathNodes = [...way.nodes];
    let currentTags = { ...way.tags };
    visitedWays.add(way.id);

    const canJoin = (w1Tags, w2Tags) => {
      const n1 = w1Tags.name;
      const n2 = w2Tags.name;
      const r1 = w1Tags.ref;
      const r2 = w2Tags.ref;
      if (n1 && n2 && n1 === n2) return true;
      if (r1 && r2 && r1 === r2) return true;
      if (!n1 || !n2) return true;
      return false;
    };

    // Expand Forward
    let changed = true;
    while (changed) {
      changed = false;
      const tail = currentPathNodes[currentPathNodes.length - 1];
      const connectingWayIds = nodeToWays[tail] || [];
      for (const nextWayId of connectingWayIds) {
        if (visitedWays.has(nextWayId)) continue;
        const nextWay = wayMap.get(nextWayId);
        if (canJoin(currentTags, nextWay.tags)) {
          const nextNodes = nextWay.nodes[0] === tail ? nextWay.nodes : [...nextWay.nodes].reverse();
          currentPathNodes = [...currentPathNodes, ...nextNodes.slice(1)];
          visitedWays.add(nextWayId);
          if (!currentTags.name && nextWay.tags.name) currentTags.name = nextWay.tags.name;
          changed = true;
          break;
        }
      }
    }

    // Expand Backward
    changed = true;
    while (changed) {
      changed = false;
      const head = currentPathNodes[0];
      const connectingWayIds = nodeToWays[head] || [];
      for (const prevWayId of connectingWayIds) {
        if (visitedWays.has(prevWayId)) continue;
        const prevWay = wayMap.get(prevWayId);
        if (canJoin(currentTags, prevWay.tags)) {
          const prevNodes = prevWay.nodes[prevWay.nodes.length - 1] === head ? prevWay.nodes : [...prevWay.nodes].reverse();
          currentPathNodes = [...prevNodes, ...currentPathNodes.slice(1)];
          visitedWays.add(prevWayId);
          if (!currentTags.name && prevWay.tags.name) currentTags.name = prevWay.tags.name;
          changed = true;
          break;
        }
      }
    }

    const coords = currentPathNodes.map(id => nodes.get(id)).filter(c => !!c);
    if (coords.length >= 2) {
      // Analyze intersections for "Major" status
      let hasMajorIntersection = false;
      let intersectionCount = 0;
      let stopSignCount = 0;

      for (const nodeId of currentPathNodes) {
        if (stopSigns.has(nodeId)) stopSignCount++;
        const connectedWays = nodeToWays[nodeId] || [];

        // It's an intersection if it connects to a way that ISN'T one of our merged segments
        const externalWays = connectedWays.filter(id => !visitedWays.has(id));
        if (externalWays.length > 0) {
          intersectionCount++;
          // Check if any external way is a major road
          if (externalWays.some(id => majorWayIds.has(id))) {
            hasMajorIntersection = true;
          }
        }
      }

      mergedRoads.push({
        id: way.id,
        name: currentTags.name || currentTags.ref || "Unnamed Road",
        type: currentTags.highway,
        coordinates: coords,
        tags: currentTags,
        intersections: intersectionCount,
        stopSigns: stopSignCount,
        hasMajorIntersection
      });
    }
  }

  return mergedRoads;
};

const countIntersections = (nodes, nodeToWays) => {
  let count = 0;
  for (const id of nodes) {
    if (nodeToWays[id] && nodeToWays[id].length > 2) count++;
  }
  return count;
};

const countStopSigns = (nodes, stopSigns) => {
  let count = 0;
  for (const id of nodes) {
    if (stopSigns.has(id)) count++;
  }
  return count;
};
