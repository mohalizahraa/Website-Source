#!/usr/bin/env node
import { chromium } from "playwright";

const docUrl = process.env.DOC_URL;
if (!docUrl || !/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]+\//.test(docUrl)) {
  console.error("DOC_URL must be a native Google Docs URL");
  process.exit(2);
}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function clickIfVisible(locator, timeout=1200){
  try { if(await locator.isVisible({timeout})){ await locator.click(); return true; } } catch {}
  return false;
}
async function dump(page,label){
  try{
    const items=await page.locator('[role="menuitem"],[role="option"],[role="button"],[aria-label],[title]').evaluateAll(nodes=>
      nodes.slice(0,700).map(n=>({
        role:n.getAttribute("role"),aria:n.getAttribute("aria-label"),title:n.getAttribute("title"),
        text:(n.textContent||"").trim().replace(/\s+/g," ").slice(0,160)
      })).filter(x=>x.text||x.aria||x.title)
    );
    console.log("UI_DUMP "+label+": "+JSON.stringify(items));
  }catch(err){ console.log("UI_DUMP_FAILED "+label+": "+(err?.message||err)); }
}
async function focusEditor(page){
  for(const label of ["Got it","No thanks","Dismiss","Close"]) await clickIfVisible(page.getByRole("button",{name:label,exact:true}));
  for(const loc of [page.locator(".kix-appview-editor"),page.locator(".kix-page-paginated"),page.locator('[role="textbox"]')]){
    try{ if(await loc.first().isVisible({timeout:2500})){ await loc.first().click({position:{x:160,y:180}}); return; } }catch{}
  }
  const v=page.viewportSize()||{width:1440,height:1000};
  await page.mouse.click(Math.floor(v.width*.55),Math.floor(v.height*.45));
}
async function insertTopRightPageNumbers(page){
  await focusEditor(page);
  await page.keyboard.press("Meta+Home").catch(()=>{});
  await sleep(500);

  const insertMenu=page.locator("#docs-insert-menu");
  if(await insertMenu.isVisible({timeout:4000}).catch(()=>false)) await insertMenu.click();
  else {
    const insertText=page.getByText("Insert",{exact:true}).first();
    if(!(await insertText.isVisible({timeout:3000}).catch(()=>false))){
      await dump(page,"no-insert-menu"); throw new Error("Could not find Insert menu");
    }
    await insertText.click();
  }
  await sleep(500);

  const pageElements=page.getByText("Page elements",{exact:true}).last();
  if(await pageElements.isVisible({timeout:1800}).catch(()=>false)){
    await pageElements.hover(); await sleep(600);
  }

  let pageNumber=page.getByText("Page number",{exact:true}).last();
  if(!(await pageNumber.isVisible({timeout:1800}).catch(()=>false))) pageNumber=page.getByText(/Page numbers?/i).last();
  if(!(await pageNumber.isVisible({timeout:2500}).catch(()=>false))){
    await dump(page,"page-number-menu-missing"); throw new Error("Could not find Page number menu");
  }
  await pageNumber.hover();
  await sleep(800);

  const nodes=page.locator('[role="menuitem"]:visible,[role="option"]:visible,[role="button"]:visible,[tabindex="0"]:visible');
  const count=await nodes.count();
  const choices=[];
  for(let i=0;i<count;i++){
    const n=nodes.nth(i);
    const aria=(await n.getAttribute("aria-label"))||"";
    const title=(await n.getAttribute("title"))||"";
    const text=((await n.textContent())||"").trim().replace(/\s+/g," ");
    const hay=(aria+" "+title+" "+text).trim();
    if(/page number|header|footer|top|bottom/i.test(hay)) choices.push({i,aria,title,text});
  }
  console.log("PAGE_NUMBER_CHOICES="+JSON.stringify(choices));

  const preferred=choices.find(x=>/top.*right|right.*top|header.*right|right.*header/i.test(x.aria+" "+x.title+" "+x.text));
  if(preferred){
    await nodes.nth(preferred.i).click();
    console.log("PAGE_NUMBER_TOP_RIGHT_SELECTED_BY_LABEL");
    return;
  }

  // Google Docs presents four page-number cards in order: top/right with first page,
  // top/right skipping first page, bottom/right with first page, bottom/right skipping first.
  // Restrict the fallback to visible option-like nodes whose accessible text itself mentions page numbering.
  const pageChoices=choices.filter(x=>/page number/i.test(x.aria+" "+x.title) && !/^Page numbers?$/.test(x.text));
  if(pageChoices.length){
    await nodes.nth(pageChoices[0].i).click();
    console.log("PAGE_NUMBER_TOP_RIGHT_SELECTED_BY_FIRST_NATIVE_CARD");
    return;
  }

  await dump(page,"page-number-format-missing");
  throw new Error("Page-number submenu opened but top-right native option was not identifiable");
}

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},locale:"en-US"});
const page=await context.newPage();
try{
  await page.goto(docUrl,{waitUntil:"domcontentloaded",timeout:120000});
  await page.waitForTimeout(8000);
  console.log("PAGE_TITLE="+await page.title());
  if(/sign in/i.test(await page.title()) && /accounts\.google\.com/.test(page.url())) throw new Error("Document unexpectedly requires sign-in");
  await insertTopRightPageNumbers(page);
  await page.waitForTimeout(7000);
  console.log("GOOGLE_DOCS_PAGE_NUMBERS_ATTEMPT_COMPLETED");
}catch(err){
  console.error("GOOGLE_DOCS_PAGE_NUMBERS_FAILED",err?.stack||err);
  await dump(page,"failure");
  process.exitCode=1;
}finally{
  await browser.close();
}
