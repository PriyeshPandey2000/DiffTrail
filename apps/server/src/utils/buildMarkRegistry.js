export async function buildMarkRegistry(page){
const clickableItems=await page.getByRole('button').all();
console.log(clickableItems);
}