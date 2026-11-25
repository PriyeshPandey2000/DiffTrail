import type { Page } from 'playwright';

export async function buildMarkRegistry(page: Page){
const clickableItems=await page.getByRole('button').all();
console.log(clickableItems);
}
