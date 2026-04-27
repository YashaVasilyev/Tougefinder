export default async function handler(req, res) {
  const { data } = req.query;

  if (!data) {
    return res.status(400).json({ error: 'Missing data query parameter' });
  }

  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter'
  ];

  for (const baseUrl of MIRRORS) {
    try {
      const response = await fetch(`${baseUrl}?data=${encodeURIComponent(data)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'TougeFinder/1.0'
        }
      });

      if (!response.ok) continue;

      const result = await response.json();
      return res.status(200).json(result);
    } catch (error) {
      console.error(`Mirror ${baseUrl} failed:`, error);
    }
  }

  return res.status(500).json({ error: 'All Overpass mirrors failed or timed out.' });
}
