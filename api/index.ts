import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// Enable CORS for all origins
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

const idCache = new Map<string, string>();

async function getAnilistInfo(anilistId: string) {
  try {
    const query = `
      query {
        Media (id: ${parseInt(anilistId)}, type: ANIME) {
          title { romaji english native }
          format
          synonyms
        }
      }
    `;
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({ query })
    });
    
    if (!res.ok) {
      throw new Error(`Anilist API returned ${res.status}`);
    }
    
    const data = await res.json();
    return data.data?.Media;
  } catch (error) {
    console.error('Error fetching Anilist info, falling back to Kitsu:', error);
    try {
      // Fallback to Kitsu API if Anilist rate limits (429 on Cloudflare Workers)
      const kitsuRes = await fetch(`https://kitsu.io/api/edge/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistId}&include=item`);
      if (!kitsuRes.ok) throw new Error(`Kitsu API returned ${kitsuRes.status}`);
      const kitsuData = await kitsuRes.json();
      const anime = kitsuData.included?.find((i: any) => i.type === 'anime');
      if (anime) {
        return {
          title: {
            english: anime.attributes.titles.en || null,
            romaji: anime.attributes.titles.en_jp || null,
            native: anime.attributes.titles.ja_jp || null,
          },
          format: anime.attributes.subtype === 'movie' || anime.attributes.showType === 'movie' ? 'MOVIE' : 'TV',
          synonyms: anime.attributes.abbreviatedTitles || []
        };
      }
    } catch (kitsuError) {
      console.error('Error fetching from Kitsu fallback:', kitsuError);
    }
    return null;
  }
}

export async function getAniwaveIdFromAnilist(anilistId: string) {
  try {
    if (idCache.has(anilistId)) return idCache.get(anilistId)!;

    const media = await getAnilistInfo(anilistId);
    if (!media) return null;

    const titles = media.title;
    const isMovie = media.format === 'MOVIE';
    const cleanTitle = (str: string) => str.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const removeParens = (str: string) => str.replace(/\(.*?\)/g, '').trim();

    let results: any[] = [];
    const searchQueries = [
      titles.english,
      titles.romaji,
      titles.english ? removeParens(titles.english) : null,
      titles.romaji ? removeParens(titles.romaji) : null,
      titles.english ? cleanTitle(titles.english) : null,
      titles.romaji ? cleanTitle(titles.romaji) : null,
      titles.english ? titles.english.split(':')[0] : null,
      titles.romaji ? titles.romaji.split(':')[0] : null,
      titles.english ? titles.english.split('-')[0] : null,
      titles.romaji ? titles.romaji.split('-')[0] : null,
    ].filter(Boolean);

    const uniqueQueries = [...new Set(searchQueries)];

    for (const q of uniqueQueries) {
      if (!q || q.length < 2) continue;
      try {
        const url = `https://aniwaves.ru/filter?keyword=${encodeURIComponent(q as string)}`;
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
          }
        });
        const html = await response.text();
        
        const regex = /<a class="name d-title" href="\/watch\/([^"]+)"(?: data-jp="([^"]*)")?[^>]*>([^<]+)<\/a>/g;
        let match;
        while ((match = regex.exec(html)) !== null) {
          if (!results.find(r => r.id === match![1])) {
            let enTitle = match![3];
            enTitle = enTitle.replace(/&amp;/g, '&')
                             .replace(/&quot;/g, '"')
                             .replace(/&#039;/g, "'")
                             .replace(/&lt;/g, '<')
                             .replace(/&gt;/g, '>');
                             
            results.push({
              id: match![1],
              jp: (match![2] || '').toLowerCase(),
              en: enTitle.toLowerCase()
            });
          }
        }
        
        if (results.length > 0) break;
      } catch (e) {
        console.error('Error fetching from aniwaves during search:', e);
      }
    }
  
  const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const getWords = (str: string) => str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  const primaryTitles = [titles.english, titles.romaji].filter(Boolean);
  const allTitles = [...primaryTitles, ...(media.synonyms || [])].filter(Boolean);

  let bestMatch = null;
  
  // 1. Exact match on primary titles
  const normalizedPrimary = primaryTitles.map(normalize);
  bestMatch = results.find(r => normalizedPrimary.includes(normalize(r.jp)) || normalizedPrimary.includes(normalize(r.en)));

  // 2. Exact match on all titles (including synonyms)
  if (!bestMatch) {
    const normalizedAll = allTitles.map(normalize);
    const validNormalizedAll = normalizedAll.filter(t => t.length > 5);
    bestMatch = results.find(r => validNormalizedAll.includes(normalize(r.jp)) || validNormalizedAll.includes(normalize(r.en)));
  }
  
  // 3. Similarity match if exact match fails
  if (!bestMatch && results.length > 0) {
    let highestScore = 0;
    
    for (const result of results) {
      const resEnWords = getWords(result.en);
      const resJpWords = getWords(result.jp);
      
      const isResultMovie = resEnWords.includes('movie') || resJpWords.includes('movie') || resEnWords.includes('film') || resJpWords.includes('film');
      let formatMultiplier = 1.0;
      if (isMovie && isResultMovie) formatMultiplier = 1.2;
      if (isMovie && !isResultMovie) formatMultiplier = 0.8;
      if (!isMovie && isResultMovie) formatMultiplier = 0.8;
      
      for (const possible of primaryTitles) {
        const posWords = getWords(possible as string);
        
        const calcScore = (w1: string[], w2: string[]) => {
          if (!w1.length || !w2.length) return 0;
          const set1 = new Set(w1);
          const set2 = new Set(w2);
          const intersection = new Set([...set1].filter(x => set2.has(x)));
          const union = new Set([...set1, ...set2]);
          return intersection.size / union.size;
        };
        
        const scoreEn = calcScore(posWords, resEnWords) * formatMultiplier;
        const scoreJp = calcScore(posWords, resJpWords) * formatMultiplier;
        const maxScore = Math.max(scoreEn, scoreJp);
        
        if (maxScore > highestScore) {
          highestScore = maxScore;
          bestMatch = result;
        }
      }
    }
    
    if (highestScore < 0.4) {
      bestMatch = null;
    }
  }

  if (bestMatch) {
    idCache.set(anilistId, bestMatch.id);
    return bestMatch.id;
  }

  return null;
  } catch (error) {
    console.error('Error in getAniwaveIdFromAnilist:', error);
    throw error;
  }
}

app.get('/api/search', async (c) => {
  const keyword = c.req.query('keyword');
  if (!keyword) {
    return c.json({ error: 'Keyword is required' }, 400);
  }

  const url = `https://aniwaves.ru/filter?keyword=${encodeURIComponent(keyword)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
    const html = await response.text();

    const results: any[] = [];
    const regex = /<a class="name d-title" href="\/watch\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      let title = match[2];
      title = title.replace(/&amp;/g, '&')
                   .replace(/&quot;/g, '"')
                   .replace(/&#039;/g, "'")
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>');
      
      results.push({
        id: match[1],
        title: title
      });
    }

    return c.json({ results });
  } catch (error: any) {
    console.error('Error scraping:', error);
    return c.json({ error: 'Failed to scrape data', details: error.message }, 500);
  }
});

app.get('/api/episodes', async (c) => {
  const id = c.req.query('id');
  if (!id) {
    return c.json({ error: 'id is required' }, 400);
  }

  try {
    const aniwaveId = await getAniwaveIdFromAnilist(id);
    if (!aniwaveId) {
      return c.json({ error: 'Anime not found on Aniwave' }, 404);
    }

    // Extract numeric ID from the slug (e.g., naruto-76396 -> 76396)
    const numericIdMatch = aniwaveId.match(/-(\d+)$/);
    const numericId = numericIdMatch ? numericIdMatch[1] : aniwaveId;

    const episodesUrl = `https://aniwaves.ru/ajax/episode/list/${numericId}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const response = await fetch(episodesUrl, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch episodes list: ${response.status}`);
    }
    const data = await response.json();
    const html = data.result;

    if (!html) {
      return c.json({ error: 'Episodes not found' }, 404);
    }

    const episodes: any[] = [];
    const regex = /<li[^>]*title="([^"]+)"[^>]*>\s*<a[^>]*data-num="([0-9.]+)"[^>]*data-sub="([0-9]*)"[^>]*data-dub="([0-9]*)"[^>]*>[\s\S]*?<\/a>\s*<\/li>/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
      episodes.push({
        title: match[1],
        number: parseFloat(match[2]),
        isSub: match[3] === '1',
        isDub: match[4] === '1'
      });
    }

    // Sort episodes sequentially
    episodes.sort((a, b) => a.number - b.number);

    return c.json({
      id,
      aniwaveId,
      episodes
    });

  } catch (error: any) {
    console.error('Error fetching episodes:', error);
    return c.json({ error: 'Failed to fetch episodes data', details: error.message }, 500);
  }
});

app.get('/api/stream', async (c) => {
  const id = c.req.query('id');
  const ep = c.req.query('ep');
  const type = c.req.query('type');
  const server = c.req.query('server');

  if (!id || !ep || !type) {
    return c.json({ error: 'id, ep, and type are required' }, 400);
  }

  let targetServer = 'Vidplay'; // default to Vidplay (HD-2)
  const srv = server?.toLowerCase();
  if (srv === 'mycloud' || srv === 'hd-1') {
    targetServer = 'MyCloud';
  } else if (srv === 'vidplay' || srv === 'hd-2') {
    targetServer = 'Vidplay';
  }

  try {
    const aniwaveId = await getAniwaveIdFromAnilist(id);
    if (!aniwaveId) {
      return c.json({ error: 'Anime not found on Aniwave' }, 404);
    }

    // Extract numeric ID from the slug (e.g., naruto-76396 -> 76396)
    const numericIdMatch = aniwaveId.match(/-(\d+)$/);
    const numericId = numericIdMatch ? numericIdMatch[1] : aniwaveId;

    const serverListUrl = `https://aniwaves.ru/ajax/server/list?servers=${numericId}&eps=${ep}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const serverListResponse = await fetch(serverListUrl, { headers });
    const serverListJson = await serverListResponse.json();
    const html = serverListJson.result;

    if (!html) {
      return c.json({ error: 'Episode not found or no servers available' }, 404);
    }

    const extractServerUrl = async (serverName: string, targetType: string) => {
      let typeBlockRegex = new RegExp(`<div class="type" data-type="${targetType}">([\\s\\S]*?)<\\/div>\\s*(?:<div class="type"|$)`, 'i');
      let typeBlockMatch = html.match(typeBlockRegex);
      
      // Fallback to ssub if sub doesn't have the server
      if ((!typeBlockMatch || !typeBlockMatch[1].match(new RegExp(`<li[^>]*data-link-id="([^"]+)"[^>]*>${serverName}<\\/li>`, 'i'))) && targetType === 'sub') {
        typeBlockRegex = new RegExp(`<div class="type" data-type="ssub">([\\s\\S]*?)<\\/div>\\s*(?:<div class="type"|$)`, 'i');
        typeBlockMatch = html.match(typeBlockRegex);
      }

      if (!typeBlockMatch) return null;
      const typeHtml = typeBlockMatch[1];

      const serverRegex = new RegExp(`<li[^>]*data-link-id="([^"]+)"[^>]*>${serverName}<\\/li>`, 'i');
      const serverMatch = typeHtml.match(serverRegex);
      if (!serverMatch) return null;
      
      const linkId = serverMatch[1];
      const sourceUrl = `https://aniwaves.ru/ajax/sources?id=${linkId}`;
      
      try {
        const sourceResponse = await fetch(sourceUrl, { headers });
        const sourceJson = await sourceResponse.json();
        return sourceJson.result?.url || null;
      } catch (e) {
        return null;
      }
    };

    const serverUrl = await extractServerUrl(targetServer, type);

    async function extractM3u8(embedUrl: string | null, serverName: string): Promise<any> {
      if (!embedUrl) return null;
      try {
        const urlObj = new URL(embedUrl);
        const embedId = urlObj.pathname.split('/').pop();
        const baseUrl = urlObj.origin + urlObj.pathname.split('/').slice(0, -1).join('/');
        const getSourcesUrl = `${baseUrl}/getSources?id=${embedId}`;
        
        const response = await fetch(getSourcesUrl, { 
          headers: { ...headers, 'Referer': urlObj.origin + '/' } 
        });
        const responseText = await response.text();
        
        if (serverName === 'MyCloud') {
          const iframeMatch = responseText.match(/<iframe[^>]+src="([^"]+)"/i);
          if (iframeMatch && iframeMatch[1]) {
            const iframeUrl = iframeMatch[1];
            const iframeUrlObj = new URL(iframeUrl);
            const iframeId = iframeUrlObj.pathname.split('/').pop();
            const iframeBaseUrl = iframeUrlObj.origin + iframeUrlObj.pathname.split('/').slice(0, -1).join('/');
            const iframeGetSourcesUrl = `${iframeBaseUrl}/getSources?id=${iframeId}`;
            
            const iframeResponse = await fetch(iframeGetSourcesUrl, { 
              headers: { ...headers, 'Referer': iframeUrlObj.origin + '/' } 
            });
            const data = await iframeResponse.json();
            return {
              m3u8: typeof data.sources === 'string' ? data.sources : data.sources?.[0]?.file,
              skip: {
                intro: data.intro,
                outro: data.outro
              },
              tracks: data.tracks
            };
          }
        } else {
          const data = JSON.parse(responseText);
          return {
            m3u8: typeof data.sources === 'string' ? data.sources : data.sources?.[0]?.file,
            skip: {
              intro: data.intro,
              outro: data.outro
            },
            tracks: data.tracks
          };
        }
      } catch (error) {
        console.error(`Error extracting m3u8 for ${serverName}:`, error);
      }
      return { m3u8: null };
    }

    const streamData = await extractM3u8(serverUrl, targetServer);

    return c.json({
      id,
      ep,
      type,
      server: targetServer,
      stream: streamData
    });

  } catch (error: any) {
    console.error('Error fetching stream:', error);
    return c.json({ error: 'Failed to fetch stream data', details: error.message }, 500);
  }
});

export const config = {
  runtime: 'edge',
};

export default app;
