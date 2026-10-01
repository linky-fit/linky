import { chromium, expect, type Page } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/node_modules/@playwright/test/index.js';
import { createSeedIdentity, setSeedLoginStorage } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/tests/helpers/identity.ts';
import { setBaseStorage, readBalanceSat } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/tests/helpers/appState.ts';
import { topUp } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/tests/helpers/wallet.ts';
import { addContactByNpub } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/tests/helpers/contacts.ts';
import { stubFiatRates, stubThirdPartyAssets } from '/Users/jarvis/.worktrees/fix-offline-queue-double-send/apps/web-app/tests/helpers/network.ts';
import { writeFile } from 'node:fs/promises';
const build = process.argv[2] || 'after';
const scenario = process.argv[3] || '1';
const origin = `http://127.0.0.1:${build === 'after' ? 5296 : 5297}`;
const prefix = `/tmp/pr459-qa/${build}-s${scenario}`;
const browser = await chromium.launch({headless:true});
const report: Record<string, unknown> = {build, scenario, viewport:{width:390,height:844}};
const logs: object[] = [];
const pages: Page[] = [];
const log = (stage:string, data:unknown = '') => { console.log(new Date().toISOString(), stage, JSON.stringify(data)); };
const sleep = (ms:number) => new Promise(r=>setTimeout(r, ms));
async function instrument(page:Page,label:string) {
  pages.push(page);
  page.on('console', m=>logs.push({label,type:m.type(),text:m.text(),time:Date.now()}));
  page.on('pageerror', e=>logs.push({label,type:'pageerror',text:e.message,time:Date.now()}));
  page.on('requestfailed', r=>logs.push({label,type:'requestfailed',url:r.url(),error:r.failure(),time:Date.now()}));
  page.on('response', async r=>{ if(r.url().includes(':3338/')) logs.push({label,type:'mint',url:r.url(),status:r.status(),method:r.request().method(),time:Date.now()}); });
  await stubFiatRates(page); await stubThirdPartyAssets(page);
}
async function boot(label:string) {
 const context = await browser.newContext({baseURL:origin,viewport:{width:390,height:844},serviceWorkers:'block'});
 const page = await context.newPage(); await instrument(page,label);
 const identity = await createSeedIdentity(); await setBaseStorage(page); await setSeedLoginStorage(page,identity);
 await page.goto('/#wallet'); await expect(page.getByLabel('Available balance')).toBeVisible({timeout:60000});
 return {context,page,identity};
}
const queue = (page:Page) => page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('linky.local.pendingPayments.v1.')).map(([k,v])=>[k,JSON.parse(v)])));
const events = async () => { const rows = []; let cursor = 0; for(let i=0;i<100;i++) { const batch = await (await fetch(`${origin}/__inspector/events?cursor=${cursor}`)).json(); rows.push(...batch.rows); if(!batch.rows.length || batch.cursor === cursor) break; cursor = batch.cursor; } return rows; };
const chat = async (page:Page) => ({text:await page.locator('body').innerText(), messages:await page.locator('.chat-message').evaluateAll(els=>els.map(e=>({text:(e as HTMLElement).innerText,html:e.outerHTML}))) });
async function wallet(page:Page) {await page.goto('/#wallet'); await sleep(5000); const samples=[];for(let i=0;i<3;i++){ samples.push(await readBalanceSat(page));await sleep(1000); } log('balanceSamples',samples); return samples[samples.length-1];}
try {
 await fetch(`${origin}/__inspector/clear`,{method:'POST'});
 log('boot'); const a=await boot('sender-A'); const b=await boot('receiver');
 log('topup'); await topUp(a.page,200); await expect.poll(()=>readBalanceSat(a.page),{timeout:90000}).toBe(200);
 const aid=await addContactByNpub(a.page,b.identity.npub); const bid=await addContactByNpub(b.page,a.identity.npub);
 report.initial={sender:200,receiver:0}; report.contacts={senderContact:aid,receiverContact:bid};
 let tabB:Page|undefined;
 if(scenario==='1') {tabB=await a.context.newPage();await instrument(tabB,'sender-B');await tabB.goto('/#wallet'); await expect.poll(()=>readBalanceSat(tabB!),{timeout:60000}).toBe(200);await tabB.goto(`/#chat/${aid}`);}
 await sleep(3000); log('ready',await chat(a.page));
 await a.context.setOffline(true);
 await a.page.locator('[data-guide="chat-pay"]').click();
 const amount = scenario==='3'?237:37;
 for(const digit of String(amount)) await a.page.getByRole('button',{name:digit,exact:true}).click();
 const pay=a.page.locator('[data-guide="pay-send"]');
 report.payForm=await a.page.locator('body').innerText();
 if(await pay.isDisabled()) {
  report.skipped='UI disables payment above balance'; report.queue=await queue(a.page); await a.page.screenshot({path:`${prefix}-blocked.png`}); log('skipped',report);
 } else {
 await pay.click(); await a.page.waitForURL(/#chat\//); await expect.poll(async()=>JSON.stringify(await queue(a.page))).toContain('"amountSat":37');
 await sleep(2500);report.queued={queue:await queue(a.page),chat:await chat(a.page)};log('queued',report.queued);
 let aborted=0;
 const mintPattern = ['2b','2c'].includes(scenario) ? 'http://localhost:3338/v1/swap' : 'http://localhost:3338/**';
 if(scenario.startsWith('2')) await a.context.route(mintPattern,async r=>{aborted++; if(['2b','2c'].includes(scenario)) { const response=await r.fetch(); logs.push({label:'sender-A',type:'lost-swap-response',status:response.status(),body:await response.text(),time:Date.now()}); } return r.abort('failed');});
 await a.context.setOffline(false);log('reconnected');
 await sleep(scenario==='1'?25000:15000);
 report.firstFlush={queue:await queue(a.page),senderChat:await chat(a.page),receiverChat:await chat(b.page),events:await events(),aborted};
 log('firstFlush',report.firstFlush);
 if(scenario.startsWith('2')) {await a.context.setOffline(true);await sleep(6500);report.screenshotMoment={queue:await queue(a.page),chat:await chat(a.page)};await a.page.screenshot({path:`/tmp/pr459-qa/${build}-failed-queued.png`});await a.context.unroute(mintPattern); await a.context.setOffline(true);await sleep(500);await a.context.setOffline(false);await sleep(8000);}
 await a.page.goto(`/?qaReload=${Date.now()}#chat/${aid}`);
 if(tabB) await tabB.goto(`/?qaReload=${Date.now()}#chat/${aid}`);
 await sleep(22000);
 report.finalChat={sender:await chat(a.page),receiver:await chat(b.page)};
 report.final={queue:await queue(a.page),senderBalance:await wallet(a.page),receiverBalance:await wallet(b.page),events:await events(),aborted};
 report.finalWalletText={sender:await a.page.locator('body').innerText(),receiver:await b.page.locator('body').innerText()};await a.page.screenshot({path:`${prefix}-final-wallet.png`});
 if(tabB) report.tabBBalance=await wallet(tabB);
 log('final',report.final);
 if(scenario==='2c') {
  await b.page.goto(`/#chat/${bid}`);
  await a.page.goto(`/#chat/${aid}`);await a.page.locator('[data-guide="chat-pay"]').click();
  for(const digit of '37') await a.page.getByRole('button',{name:digit,exact:true}).click();
  await a.page.locator('[data-guide="pay-send"]').click();await sleep(15000);
  report.explicitNewPayment={senderText:await a.page.locator('body').innerText(),receiverChat:await chat(b.page),senderBalance:await wallet(a.page),receiverBalance:await wallet(b.page),queue:await queue(a.page),events:await events()};
  await a.page.screenshot({path:`${prefix}-after-explicit-payment.png`});log('explicitNewPayment',report.explicitNewPayment);
 }

 }
} catch(e) {
 report.error=String(e); console.error(e);
 for(let i=0;i<pages.length;i++) {await pages[i].screenshot({path:`${prefix}-error-${i}.png`}).catch(()=>{}); report[`page${i}`]={url:pages[i].url(),text:await pages[i].locator('body').innerText().catch(()=>''),queue:await queue(pages[i]).catch(()=>null)};}
 report.events=await events().catch(()=>[]);
 process.exitCode=1;
} finally {
 await writeFile(`${prefix}-report.json`,JSON.stringify(report,null,2));await writeFile(`${prefix}-browser.json`,JSON.stringify(logs,null,2));await browser.close();log('closed browser');
}
