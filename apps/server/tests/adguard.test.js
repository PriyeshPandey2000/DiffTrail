import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { createCaptureService } from '../src/services/capture.js';
import { createAdguardContext, selectFilters } from '../src/services/adguard-context.js';
import { normalizeOptions } from '../src/services/options.js';
import { cases } from './fixtures/cleanup.js';

const enabled = process.env.RUN_ADGUARD_TESTS === '1';
let server, origin;
before(async () => {
  if (!enabled) return;
  await access(new URL('../../../.cache/adguard-runtime/extension/build.json', import.meta.url));
  server = http.createServer((req,res)=> {
    res.setHeader('Content-Type', 'text/html');
    res.end(cases[req.url.slice(1)]?.html || cases.banner.html);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  origin=`http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if(server){server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
});

test('category mapping selects upstream filters, never custom rules', () => {
  assert.deepEqual(selectFilters(normalizeOptions({url:'https://example.com',cleanup:'standard'}).cleanup),[18,19]);
  assert.deepEqual(selectFilters(normalizeOptions({url:'https://example.com',cleanup:'all'}).cleanup),[2,3,4,17,18,19,20,21,22,25]);
  assert.deepEqual(selectFilters({widgets:true}),[22]);
  assert.deepEqual(selectFilters({cookies:false}),[]);
});

test('default capture uses the official runtime and reports unverifiable counts as null', async () => {
  let calls=0, closes=0;
  const fakeContext={newPage:async()=>({setDefaultTimeout(){},setDefaultNavigationTimeout(){},goto:async()=>null,
    waitForTimeout:async()=>{},frames:()=>[],screenshot:async()=>Buffer.from('fake')})};
  const capture=createCaptureService({settleMs:0,adguardFactory:async categories=>{
    calls++;assert.equal(categories.cookies,true);
    return {context:fakeContext,close:async()=>{closes++},metadata:{rulesVersion:'test',filters:[18,19]}};
  }});
  try {
    const result=await capture({url:'https://example.com',cleanup:'standard'});
    assert.equal(calls,1);assert.ok(closes>=1);
    assert.equal(result.metadata.engine,'adguard-api-mv3');assert.equal(result.metadata.hidden,null);
    assert.equal(result.metadata.aiUsed,false);assert.equal(result.metadata.cookieRulesMayInteract,true);
    assert.equal(result.cleanup,'enabled');
  } finally {await capture.close();}
});

test('headless official runtime loads selected filters and hides an upstream banner without AI', {skip:!enabled}, async()=>{
  const worker=await createAdguardContext({cookies:true,popups:true});
  try{
    assert.deepEqual(worker.metadata.filters,[18,19]);
    const page=await worker.context.newPage();await page.goto(origin);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#cookie-banner')).display==='none',{},{timeout:7000});
    assert.equal(await page.locator('main').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.accepts),0);
  }finally{await worker.close();}
});

test('headless official capture observes delayed banners and returns a PNG', {skip:!enabled},async()=>{
  const capture=createCaptureService();
  try{
    const result=await capture({url:`${origin}/delayed`,cleanup:'standard'});
    assert.equal(result.image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(result.metadata.engine,'adguard-api-mv3');
    assert.equal(result.metadata.residual.state,'none-detected');
  }finally{await capture.close();}
});

test('persistent profiles do not leak cookies or storage to the next native worker', {skip:!enabled},async()=>{
  const first=await createAdguardContext({cookies:true});
  try{
    const page=await first.context.newPage();await page.goto(origin);
    await page.evaluate(()=>{localStorage.setItem('private-test','yes');document.cookie='private_test=yes'});
  }finally{await first.close();}
  const next=await createAdguardContext({cookies:true});
  try{
    const page=await next.context.newPage();await page.goto(origin);
    assert.equal(await page.evaluate(()=>localStorage.getItem('private-test')),null);
    assert.equal((await next.context.cookies()).some(cookie=>cookie.name==='private_test'),false);
  }finally{await next.close();}
});
