import { test, expect } from '@playwright/test';

test('la home abre y tiene título', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Emprendedores/);
});
