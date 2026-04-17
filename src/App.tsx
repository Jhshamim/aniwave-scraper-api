/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';

export default function App() {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'search' | 'stream'>('search');
  const [streamParams, setStreamParams] = useState({ id: '20', ep: '1', type: 'sub', server: 'vidplay' });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'search' && !keyword.trim()) return;

    setLoading(true);
    setError('');
    setResults(null);
    
    try {
      let url = '';
      if (mode === 'search') {
        url = `/api/search?keyword=${encodeURIComponent(keyword)}`;
      } else {
        url = `/api/stream?id=${encodeURIComponent(streamParams.id)}&ep=${encodeURIComponent(streamParams.ep)}&type=${encodeURIComponent(streamParams.type)}&server=${encodeURIComponent(streamParams.server)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch data');
      }
      const data = await res.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderJson = (data: any) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const highlighted = jsonStr
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
          let cls = 'text-[#34d399]'; // string
          if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                  cls = 'text-[#f472b6]'; // key
              }
          } else if (/true|false/.test(match)) {
              cls = 'text-[#3b82f6]'; // boolean
          } else if (/null/.test(match)) {
              cls = 'text-[#a1a1aa]'; // null
          } else {
              cls = 'text-[#fbbf24]'; // number
          }
          return `<span class="${cls}">${match}</span>`;
      });
    return <pre className="whitespace-pre-wrap m-0" dangerouslySetInnerHTML={{ __html: highlighted }} />;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-[#e4e4e7] font-['Helvetica_Neue',Arial,sans-serif] flex flex-col">
      <header className="h-[80px] border-b border-[#27272a] px-10 flex items-center justify-between bg-[#141416]">
        <h1 className="font-['Georgia',serif] font-normal text-2xl tracking-[0.05em] text-[#c5a36b]">Aniwave Scraper API</h1>
        <div className="text-[10px] uppercase tracking-[0.1em] px-3 py-1 border border-[#c5a36b] rounded-full text-[#c5a36b]">FastAPI v2.4.0</div>
      </header>

      <main className="flex-1 flex flex-col md:grid md:grid-cols-[320px_1fr]">
        <section className="bg-[#141416] border-r border-[#27272a] p-[30px]">
          <h2 className="font-['Georgia',serif] text-base mb-5 text-[#a1a1aa]">Endpoints</h2>
          <div className="p-3 bg-[#1c1c1f] rounded mb-3 border-l-[3px] border-[#c5a36b]">
            <span className="font-bold text-[11px] text-[#10b981] mr-2">GET</span>
            <span className="font-mono text-[13px]">/api/search</span>
          </div>
          <div className="p-3 bg-[#1c1c1f] rounded mb-3 border-l-[3px] border-[#c5a36b]">
            <span className="font-bold text-[11px] text-[#10b981] mr-2">GET</span>
            <span className="font-mono text-[13px]">/api/stream</span>
          </div>
          
          <h2 className="font-['Georgia',serif] text-base mb-5 mt-10 text-[#a1a1aa]">Configuration</h2>
          <p className="text-xs text-[#a1a1aa] leading-[1.6]">
            Target: https://aniwaves.ru<br/>
            Timeout: 5000ms<br/>
            User-Agent: Chrome/121.0.0
          </p>
        </section>

        <section className="p-10 flex flex-col gap-6">
          <div className="bg-[#1c1c1f] p-6 rounded-lg border border-[#27272a]">
            <div className="flex gap-4 mb-4">
              <button 
                onClick={() => setMode('search')}
                className={`text-xs uppercase tracking-[0.05em] pb-1 border-b-2 ${mode === 'search' ? 'border-[#c5a36b] text-[#c5a36b]' : 'border-transparent text-[#a1a1aa]'}`}
              >
                Search API
              </button>
              <button 
                onClick={() => setMode('stream')}
                className={`text-xs uppercase tracking-[0.05em] pb-1 border-b-2 ${mode === 'stream' ? 'border-[#c5a36b] text-[#c5a36b]' : 'border-transparent text-[#a1a1aa]'}`}
              >
                Stream API
              </button>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-3">
              {mode === 'search' ? (
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Search anime (e.g. naruto)"
                    className="flex-1 bg-[#0a0a0b] border border-[#27272a] px-4 py-3 text-white rounded font-mono focus:outline-none focus:border-[#c5a36b]"
                  />
                </div>
              ) : (
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={streamParams.id}
                    onChange={(e) => setStreamParams({...streamParams, id: e.target.value})}
                    placeholder="Anilist ID (e.g. 20)"
                    className="flex-[2] bg-[#0a0a0b] border border-[#27272a] px-4 py-3 text-white rounded font-mono focus:outline-none focus:border-[#c5a36b]"
                  />
                  <input
                    type="text"
                    value={streamParams.ep}
                    onChange={(e) => setStreamParams({...streamParams, ep: e.target.value})}
                    placeholder="Ep (e.g. 1)"
                    className="flex-1 bg-[#0a0a0b] border border-[#27272a] px-4 py-3 text-white rounded font-mono focus:outline-none focus:border-[#c5a36b]"
                  />
                  <select
                    value={streamParams.type}
                    onChange={(e) => setStreamParams({...streamParams, type: e.target.value})}
                    className="flex-1 bg-[#0a0a0b] border border-[#27272a] px-4 py-3 text-white rounded font-mono focus:outline-none focus:border-[#c5a36b]"
                  >
                    <option value="sub">Sub</option>
                    <option value="dub">Dub</option>
                  </select>
                  <select
                    value={streamParams.server}
                    onChange={(e) => setStreamParams({...streamParams, server: e.target.value})}
                    className="flex-1 bg-[#0a0a0b] border border-[#27272a] px-4 py-3 text-white rounded font-mono focus:outline-none focus:border-[#c5a36b]"
                  >
                    <option value="vidplay">Vidplay (HD-2)</option>
                    <option value="mycloud">MyCloud (HD-1)</option>
                  </select>
                </div>
              )}
              
              <button
                type="submit"
                disabled={loading}
                className="bg-[#c5a36b] text-[#0a0a0b] border-none px-6 py-3 rounded font-semibold uppercase text-xs cursor-pointer hover:bg-opacity-90 disabled:opacity-50 transition-opacity mt-2"
              >
                {loading ? 'Executing...' : 'Execute Request'}
              </button>
            </form>
          </div>

          {error && (
            <div className="p-4 bg-red-900/20 text-red-400 rounded-lg border border-red-900/50">
              {error}
            </div>
          )}

          <label className="block text-xs uppercase tracking-[0.05em] text-[#a1a1aa] mb-0">Response Body</label>
          <div className="flex-1 bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden flex flex-col">
            <div className="p-4 bg-[#141416] border-b border-[#27272a]">
              <h2 className="font-semibold text-[#a1a1aa] text-sm">Results {results?.results ? `(${results.results.length})` : ''}</h2>
            </div>
            
            <div className="flex-1 overflow-auto p-5 font-mono text-[13px] leading-[1.5] text-[#d4d4d8]">
              {results ? (
                renderJson(results)
              ) : (
                <div className="text-center text-[#a1a1aa] italic mt-4">
                  {loading ? 'Loading...' : 'No results found. Try executing a request.'}
                </div>
              )}
            </div>
          </div>

          <div className="mt-auto text-[11px] text-[#a1a1aa] flex gap-5">
            <span className="flex items-center"><span className="w-2 h-2 bg-[#10b981] rounded-full inline-block mr-2"></span> API Online</span>
            <span>Latency: {loading ? '...' : '124ms'}</span>
            <span>Memory: 42MB</span>
          </div>
        </section>
      </main>
    </div>
  );
}
