import { expect, test } from '@playwright/test';

test('five required interactions and purchase flow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const catalog = page.getByRole('button', { name: /Каталог/ });
  await catalog.click();
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeVisible();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeHidden();

  await page.getByRole('button', { name: 'Баннер 2' }).click();
  await expect(page.getByRole('heading', { name: /Пополняйте/ })).toBeVisible();
  await page.getByRole('button', { name: '₽' }).click();
  await expect(page.getByRole('button', { name: '₽' })).toHaveClass(/active/);

  await page.getByRole('button', { name: /Steam/ }).first().hover();
  const firstCard = page.locator('.product-card').first();
  await firstCard.hover();
  await expect(firstCard).toBeVisible();

  await firstCard.getByRole('button', { name: 'Купить' }).dblclick();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Оплатить успешно' }).click();
  await expect(page.getByRole('heading', { name: 'Товар выдан' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.code-box strong')).toHaveText(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
});

test('narrow viewport does not overflow horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
