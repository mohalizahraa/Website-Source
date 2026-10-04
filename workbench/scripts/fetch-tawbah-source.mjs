import { mkdir, writeFile } from 'node:fs/promises';

const url='https://archive.alhaydari.com/ebook/ar/%D9%83%D8%AA%D8%A8-%D8%A7%D9%84%D8%A3%D8%AE%D9%84%D8%A7%D9%82/%D8%A7%D9%84%D8%AA%D9%88%D8%A8%D8%A9-%D8%AD%D9%82%D9%8A%D9%82%D8%AA%D9%87%D8%A7-%D9%88%D8%B4%D8%B1%D9%88%D8%B7%D9%87%D8%A7-%D9%88%D8%A2%D8%AB%D8%A7%D8%B1%D9%87%D8%A7.pdf';
const response=await fetch(url,{redirect:'follow',headers:{accept:'application/pdf,*/*;q=0.8','user-agent':'Haydari-Workbench-BuildBridge/1.0'}});
if(!response.ok) throw new Error(`Tawbah source fetch failed: HTTP ${response.status}`);
const type=(response.headers.get('content-type')||'').toLowerCase();
if(!type.includes('application/pdf')) throw new Error(`Unexpected Tawbah content type: ${type}`);
const bytes=new Uint8Array(await response.arrayBuffer());
if(bytes.byteLength<100000 || bytes.byteLength>2*1024*1024) throw new Error(`Unexpected Tawbah PDF size: ${bytes.byteLength}`);
await mkdir(new URL('../public/_source/',import.meta.url),{recursive:true});
await writeFile(new URL('../public/_source/tawbah.pdf',import.meta.url),bytes);
console.log(`Prepared authoritative Tawbah source asset (${bytes.byteLength} bytes).`);
