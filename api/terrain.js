export default async function handler(req, res) {
  const { locations } = req.query;

  if (!locations) {
    return res.status(400).json({ error: 'Missing locations parameter' });
  }

  try {
    const response = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locations}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: 'Upstream API error', details: errorText });
    }

    const data = await response.json();
    
    // Add CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
