import express from 'express';
import {chromium} from 'playwright';
const app=express();
app.use(express.json());
app.get('/',(req,res)=>res.send("server running"));
app.post('/screenshot',async (req,res)=>{
const url=req.body.url;
const browser= await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2
});
const page = await context.newPage();
await page.goto(`${url}`);
await page.screenshot({ path: 'screenshot333.png' ,type: 'png'});
  await browser.close();
res.send({done:"job done"})

})

app.listen(3000,()=>console.log("listening on port 3000"));