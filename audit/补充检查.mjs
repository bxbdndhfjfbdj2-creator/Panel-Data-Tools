import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const output=[];
try {
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8081/',{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'开始筛选',exact:true}).click();
  await page.waitForTimeout(850);
  const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('hengce.workspace.v1')).savedAt);
  await page.evaluate(()=>{window.__failedWrites=0;Storage.prototype.setItem=function(){window.__failedWrites++;throw new DOMException('quota','QuotaExceededError');};});
  await page.getByRole('button',{name:'进入体系',exact:true}).click();
  await page.waitForTimeout(1300);
  await page.getByRole('button',{name:'方案',exact:true}).click();
  output.push({id:'quota-feedback',savedAtInStorage:before,restoreLabel:await page.getByRole('button').filter({hasText:'恢复上次'}).innerText(),failedWriteCount:await page.evaluate(()=>window.__failedWrites),errorNotifications:await page.locator('[data-sonner-toast][data-type=error]').allTextContents()});
} finally {
  await browser.close();
  writeFileSync(new URL('./supplementary-browser.json',import.meta.url),JSON.stringify(output,null,2));
}
console.log(output);
