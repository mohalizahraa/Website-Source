import { BOOK_CATALOG } from '../_catalog.js';

const UA = 'Mozilla/5.0 Haydari-Workbench-Cover-Recovery/3.0';

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
function abs(raw,base){ try { return new URL(String(raw||'').replaceAll('&amp;','&'),base).href; } catch { return null; } }
function cleanTitle(value=''){ return value.replace(/[\u064B-\u065F\u0670]/g,'').replace(/\s+/g,' ').trim(); }
function strippedTitle(value=''){ return value.replace(/\s*[–-]?\s*ج\s*\(?\d+\)?\s*$/u,'').trim(); }
async function getText(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA},signal:AbortSignal.timeout(12000)});
    if(!r.ok) return null;
    return {text:await r.text(),url:r.url,type:r.headers.get('content-type')||''};
  }catch{return null;}
}
function scoreUrl(url,key='',context='',book=null){
  let score=0;
  const lower=url.toLowerCase(), k=key.toLowerCase();
  if(/featured|source_url|og_image|thumbnail|medium|large/.test(k)) score+=6;
  if(/logo|avatar|icon|banner|header|footer|social|facebook|twitter|youtube|instagram|whatsapp|telegram/.test(lower)) score-=15;
  if(/\/files\//.test(lower)||/uploads/.test(lower)) score+=3;
  if(/pagespeed/.test(lower)) score+=1;
  if(book){
    const ctx=cleanTitle(context);
    const title=cleanTitle(book.title_ar);
    if(ctx.includes(title)) score+=12;
    const toks=title.split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=3).slice(0,7);
    for(const t of toks) if(ctx.includes(t)||decodeURIComponent(lower).includes(t)) score+=2;
  }
  return score;
}
function imageUrlsFromJson(obj,book){
  const out=[],seen=new Set();
  const walk=(v,k='')=>{
    if(v==null)return;
    if(typeof v==='string'){
      if(/^https?:\/\//i.test(v)&&/\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(v)&&!seen.has(v)){
        seen.add(v);out.push({url:v,via:'wp-json',score:scoreUrl(v,k,'',book)});
      }
    }else if(Array.isArray(v))v.forEach(x=>walk(x,k));
    else if(typeof v==='object')for(const [kk,vv] of Object.entries(v))walk(vv,kk);
  };
  walk(obj);return out;
}
function htmlCandidates(got,book,via,contextBoost=0){
  const out=[];
  for(const m of got.text.matchAll(/(?:src|data-src|data-lazy-src|data-original|href)=["']([^"']+\.(?:jpe?g|png|webp|gif)(?:\?[^"']*)?)["']/gi)){
    const url=abs(m[1],got.url); if(!url)continue;
    const i=m.index||0,context=got.text.slice(Math.max(0,i-1400),Math.min(got.text.length,i+1400));
    out.push({url,via,score:scoreUrl(url,'html',context,book)+contextBoost});
  }
  for(const m of got.text.matchAll(/(?:https?:\/\/[^"'<>\s)]+|\/ar\/files\/[^"'<>\s)]+|\/fa\/files\/[^"'<>\s)]+)\.(?:jpe?g|png|webp|gif)(?:[^"'<>\s)]*)?/gi)){
    const url=abs(m[0],got.url);if(url)out.push({url,via,score:scoreUrl(url,'raw',m[0],book)+contextBoost});
  }
  return out;
}
async function verifyImage(url){
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'user-agent':UA,'range':'bytes=0-2047'},signal:AbortSignal.timeout(12000)});
    const type=(r.headers.get('content-type')||'').toLowerCase();
    const ok=(r.ok||r.status===206)&&type.startsWith('image/');
    try{await r.body?.cancel();}catch{}
    return ok ? (r.url||url) : null;
  }catch{return null;}
}
async function recover(book){
  const candidates=[];
  const postId=(book.detail_url.match(/\/(\d+)\/?$/)||[])[1];
  for(const url of [
    `https://alhaydari.com/ar/wp-json/wp/v2/posts/${postId}?_embed=1`,
    `https://alhaydari.com/wp-json/wp/v2/posts/${postId}?_embed=1`,
    `https://alhaydari.com/ar/?rest_route=/wp/v2/posts/${postId}&_embed=1`,
    `https://alhaydari.com/?rest_route=/wp/v2/posts/${postId}&_embed=1`,
  ]){
    const got=await getText(url); if(!got)continue;
    try{candidates.push(...imageUrlsFromJson(JSON.parse(got.text),book));}catch{}
  }
  const detail=await getText(book.detail_url);
  if(detail)candidates.push(...htmlCandidates(detail,book,'ar-detail',1));
  const queries=[book.title_ar,strippedTitle(book.title_ar)];
  for(const lang of ['ar','fa']){
    for(const q of queries){
      const got=await getText(`https://alhaydari.com/${lang}/?s=${encodeURIComponent(q)}`);
      if(!got)continue;
      candidates.push(...htmlCandidates(got,book,`${lang}-search`,lang==='fa'?2:0));
      const title=cleanTitle(book.title_ar);
      const idx=cleanTitle(got.text).indexOf(title.slice(0,Math.min(24,title.length)));
      if(idx>=0){
        const near=got.text.slice(Math.max(0,idx-5000),Math.min(got.text.length,idx+5000));
        for(const h of near.matchAll(/href=["']([^"']+)["']/gi)){
          const href=abs(h[1],got.url);
          if(!href||!/alhaydari\.com\/(?:ar|fa)\/\d{4}\//.test(href))continue;
          const pg=await getText(href); if(pg)candidates.push(...htmlCandidates(pg,book,href.includes('/fa/')?'fa-detail':'parallel-detail',4));
        }
      }
    }
  }
  const uniq=[...new Map(candidates.map(x=>[x.url,x])).values()].sort((a,b)=>b.score-a.score);
  const verified=[];
  for(const cand of uniq.slice(0,16)){
    if(cand.score<0)continue;
    const url=await verifyImage(cand.url);
    if(url)verified.push({...cand,url});
    if(verified.length>=6)break;
  }
  return verified;
}

export async function onRequestGet(context){
  const raw=new URL(context.request.url).searchParams.get('ids')||'';
  const ids=raw.split(',').map(x=>x.trim()).filter(Boolean).slice(0,5);
  if(!ids.length)return json({error:'Pass up to five catalog ids in ?ids='},400);
  const books=ids.map(id=>BOOK_CATALOG.find(b=>b.catalog_id===id)).filter(Boolean);
  const results={};
  for(const book of books)results[book.catalog_id]={title_ar:book.title_ar,candidates:await recover(book)};
  return json({results});
}
