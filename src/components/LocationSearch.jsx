import React, { useState } from 'react';
import { Search, MapPin, Navigation } from 'lucide-react';

const LocationSearch = ({ onSearch, loading }) => {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    // In a real app, use a geocoding API here (e.g. Mapbox Geocoding)
    // For MVP, we'll try to detect if it's a zip or city
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="relative group mb-8">
      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
        <Search className="w-5 h-5 text-zinc-500 group-focus-within:text-touge-500 transition-colors" />
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter Zip Code or City..."
        className="w-full bg-zinc-900 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-touge-600/50 focus:border-touge-600/50 transition-all shadow-inner"
      />
      <button 
        type="submit"
        disabled={loading}
        className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-2 bg-touge-600 hover:bg-touge-500 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
      >
        {loading ? '...' : 'Search'}
      </button>
    </form>
  );
};

export default LocationSearch;
