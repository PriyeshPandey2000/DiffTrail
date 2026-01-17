import express from 'express';
import {chromium} from 'playwright';
import { pngToBase64 } from '../../utils/utility.js';
import { processScreenshot } from '../../services/groq.js';

 const router=express.Router();

router.post('/screenshot',async (req,res)=>{
    const url=req.body.url;
    const browser= await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 2
    });
    // console.log(process.cwd());
    const page = await context.newPage();
    await page.goto(`${url}`);
    const snapshot = await page.locator('body').ariaSnapshot();


    await page.screenshot({ path: 'screenshot.png' ,type: 'png'});
    const base64= pngToBase64(`/Users/priyesh/Desktop/web/apps/server/screenshot.png`);
    const jsonString=await processScreenshot(snapshot,base64);
    const jsonObject=JSON.parse(jsonString);
    console.log(jsonObject);
    if(jsonObject.hasPopups==true){
      const promise=jsonObject.selectors.map(async function(selector){
        await page.locator(selector).click();
        console.log("closed banners and cookies ")
      })
      const task=await Promise.all(promise);
      console.log("all tasks done");
    }
   
    await page.screenshot({ path: 'screenshotFinal.png' ,type: 'png'});
 
      await browser.close();
    res.send({done:"job done"})

    
    })
export default router;