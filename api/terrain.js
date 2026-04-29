export default async function handler(req, res) {
  const { locations } = req.query;

  if (!locations) {
    return res.status(400).json({ error: 'Missing locations parameter' });
  }

  try {
    const allLocations = locations.split('|');
    const chunks = [];
    const chunkSize = 100; // OpenTopoData limit

    for (let i = 0; i < allLocations.length; i += chunkSize) {
      chunks.push(allLocations.slice(i, i + chunkSize).join('|'));
    }

    const allResults = [];
    for (const chunk of chunks) {
      const response = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${chunk}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upstream API error: ${errorText}`);
      }
      const data = await response.json();
      allResults.push(...data.results);
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    return res.status(200).json({ results: allResults });
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}
