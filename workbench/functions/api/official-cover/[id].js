import { COVER_SOURCES } from '../../_cover_sources.js';

function sourceCandidates(raw) {
  const candidates=[raw];
  try {
    const url=new URL(raw);
    const originalPath=url.pathname.replace(/\/x([^/]+?)\.pagespeed\.[^/]+$/u,'/$1');
    if (originalPath !== url.pathname) {
      const fallback=new URL(url);
      fallback.pathname=originalPath;
      candidates.push(fallback.toString());
    }
  } catch {}
  return [...new Set(candidates.filter(Boolean))];
}

export async function onRequestGet(context) {
  const id=String(context.params.id || '');
  const source=COVER_SOURCES[id];
  if (!source) return new Response('Cover not found',{status:404});

  for (const url of sourceCandidates(source)) {
    try {
      const response=await fetch(url,{
        headers:{accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',referer:'https://alhaydari.com/'},
        cf:{cacheEverything:true,cacheTtl:86400},
      });
      const type=response.headers.get('content-type') || '';
      if (response.ok && type.startsWith('image/')) {
        return new Response(response.body,{
          status:200,
          headers:{
            'content-type':type,
            'cache-control':'public, max-age=86400, stale-while-revalidate=604800',
          },
        });
      }
    } catch {}
  }
  return new Response('Cover unavailable',{status:404,headers:{'cache-control':'public, max-age=300'}});
}
