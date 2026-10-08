import { chromium } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
const observations=[];
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
mkdirSync('/workspace/screenshots',{recursive:true});
async function nav(page,n) { await page.getByRole('navigation').getByRole('button').filter({hasText:n}).click(); await page.waitForTimeout(450); }
try {
  for (const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:800},acceptDownloads:true});
    const page=await context.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
    await page.goto('http://127.0.0.1:8081/',{waitUntil:'networkidle'});
    for(const kind of ['panel','survey']) {
      if(kind==='survey') {
        await nav(page,'01');
        await page.getByRole('button').filter({hasText:'组织健康问卷'}).click();
      }
      for(const step of ['01','02','03','04','05']) {
        await nav(page,step);
        const metrics=await page.evaluate(()=>({
          overflow:document.documentElement.scrollWidth>innerWidth+1,
          scrollWidth:document.documentElement.scrollWidth,width:innerWidth,
          heading:document.querySelector('main h2')?.textContent,
          nTables:document.querySelectorAll('main table').length,
          textLen:document.querySelector('main')?.innerText.length,
        }));
        const path=`/workspace/screenshots/audit-${kind}-${width}-${step}.png`;
        await page.screenshot({path});
        observations.push({kind,width,step,...metrics,screenshot:path});
      }
    }
    if(width===1280) {
      await page.getByRole('button',{name:'方案',exact:true}).click();
      const downloadEvent=page.waitForEvent('download');
      await page.getByRole('button',{name:'导出方案 JSON',exact:true}).click();
      const download=await downloadEvent;
      const exportPath=new URL('./exported-workspace.json',import.meta.url).pathname;
      await download.saveAs(exportPath);
      await page.getByRole('dialog').locator('input[type=file]').setInputFiles(exportPath);
      await page.waitForTimeout(250);
      observations.push({id:'workspace-export-import',dialogClosed:await page.getByRole('dialog').count()===0,toastText:await page.locator('[data-sonner-toast]').allTextContents(),rawFileHasBOM:readFileSync(exportPath).subarray(0,3).equals(Buffer.from([239,187,191])),blobText:await page.evaluate(async()=>{const s=await new Blob(['\uFEFF{}']).text();return {startsWithBOM:s.charCodeAt(0)===65279,parsed:JSON.parse(s)};})});
      // Same-origin quota failure injection, using only a synthetic fixture in a fresh audit browser.
      await page.evaluate(()=>{window.__auditSaved=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};});
      await nav(page,'03');
      await page.getByRole('button',{name:'方案',exact:true}).click();
      observations.push({id:'save-quota-ui',restoreButtonText:await page.getByRole('button').filter({hasText:'恢复上次'}).innerText(),toastText:await page.locator('[data-sonner-toast]').allTextContents()});
      await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
      await page.evaluate(()=>{Storage.prototype.setItem=window.__auditSaved;});
      const snap=JSON.parse(readFileSync(exportPath,'utf8').replace(/^\uFEFF/,''));
      snap.dataset.dimensions=snap.dataset.dimensions.slice(0,2);
      const dimIds=new Set(snap.dataset.dimensions.map(d=>d.id));
      snap.dataset.indicators=snap.dataset.indicators.filter(i=>dimIds.has(i.dimensionId));
      snap.step='system';
      await page.getByRole('button',{name:'方案',exact:true}).click();
      await page.getByRole('dialog').locator('input[type=file]').setInputFiles({name:'two-dimensions.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snap))});
      await page.getByRole('button',{name:'层次分析',exact:true}).click();
      const slider=page.getByRole('dialog').getByRole('slider').first();
      await slider.focus(); await slider.press('Home');
      observations.push({id:'ahp-left-end',sliderValue:await slider.getAttribute('aria-valuenow'),table:await page.getByRole('dialog').locator('table').innerText()});
      await page.screenshot({path:'/workspace/screenshots/audit-ahp-reverse.png'});
    }
    observations.push({id:'browser-errors',width,errors});
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(new URL('./browser-review.json',import.meta.url),JSON.stringify(observations,null,2));
}
console.log(JSON.stringify(observations,null,2));
