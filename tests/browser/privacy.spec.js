import { test, expect } from '@playwright/test';
async function setup(page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1','localhost'].includes(url.hostname)) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status:200, json:{ items:[], providers:[] } });
    if (url.pathname.startsWith('/_vercel/')) return route.fulfill({ contentType:'application/javascript', body:'' });
    return route.continue();
  });
}
test('no measurement scripts before consent or after rejection; preference can be reopened', async ({page}) => {
  await setup(page);await page.goto('/privacy');
  await expect(page.getByRole('heading',{name:'Privacy Policy',exact:true})).toBeVisible();
  await expect(page.locator('script[src*="insights"],script[src*="analytics"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Essential only',exact:true}).click();
  await page.reload();await expect(page.getByRole('region',{name:'Cookie preferences'})).toHaveCount(0);
  await expect(page.locator('script[src*="insights"],script[src*="analytics"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();
  await expect(page.getByRole('region',{name:'Cookie preferences'})).toBeVisible();
});
test('optional allowance loads measurement; withdrawal clears it after reload', async ({page}) => {
  await setup(page);await page.goto('/cookies');
  await page.getByRole('button',{name:'Allow optional',exact:true}).click();
  await expect(page.locator('script[data-sdkn]')).toHaveCount(2);
  await page.getByRole('button',{name:'Cookie settings',exact:true}).click();
  await page.getByRole('button',{name:'Essential only',exact:true}).click();
  await page.waitForLoadState('load');
  await expect(page.locator('script[data-sdkn]')).toHaveCount(0);
});
test('private authentication pages do not load optional scripts even with consent', async ({page}) => {
  await setup(page);await page.goto('/reset-password?token=synthetic');
  await page.getByRole('button',{name:'Allow optional',exact:true}).click();
  await expect(page.locator('script[data-sdkn]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content','https://www.servix.name.ng/');
});
test('policies and cookie banner fit a phone screen', async ({page}) => {
  await setup(page);await page.setViewportSize({width:375,height:812});await page.goto('/terms');
  await expect(page.getByRole('heading',{name:'Terms of Service',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Essential only',exact:true}).click();
  await expect(page.getByRole('link',{name:'toluenetech@gmail.com',exact:true})).toBeVisible();
});
