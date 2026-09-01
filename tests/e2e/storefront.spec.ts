import { expect, test, type Page } from '@playwright/test';

/** Собирает только реальные console/page errors и возвращает снимок для финального assertion. */
function trackBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return () => errors;
}

/** Проверяет пять обязательных интерактивов и полный путь от витрины до одного кода. */
test('five required interactions and purchase flow', async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(5);

  // №1: стрелки, точки, активное состояние и автоматическая смена карусели.
  const initialHeading = await page.getByRole('heading', { level: 1 }).innerText();
  await page.getByRole('button', { name: 'Следующий баннер' }).click();
  await expect(page.getByRole('heading', { name: /Пополняйте/ })).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущий баннер' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(initialHeading);
  await page.getByRole('button', { name: 'Баннер 2' }).click();
  await expect(page.getByRole('button', { name: 'Баннер 2' })).toHaveClass(/active/);
  await expect
    .poll(() => page.getByRole('heading', { level: 1 }).innerText(), { timeout: 6_000 })
    .not.toBe('Пополняйте кошелёк без лишних шагов');

  // №2: каталог открывается, не закрывается изнутри и закрывается снаружи/повторной кнопкой.
  const catalog = page.getByRole('button', { name: /Каталог/ });
  await catalog.click();
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Каталог' }).click();
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeVisible();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeHidden();
  await catalog.click();
  await catalog.click();
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeHidden();

  // №3: все три валюты кликабельны, но не вмешиваются в серверную цену.
  await page.getByRole('button', { name: '₸', exact: true }).click();
  await expect(page.getByRole('button', { name: '₸', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: '₽', exact: true }).click();
  await expect(page.getByRole('button', { name: '₽', exact: true })).toHaveClass(/active/);

  // №4–5: hover реально меняет вычисленные стили сервиса и карточки.
  const steamService = page.getByRole('button', { name: /Steam/ }).first();
  await steamService.hover();
  await expect
    .poll(() => steamService.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none');
  const firstCard = page.locator('.product-card').first();
  await firstCard.hover();
  await expect
    .poll(() => firstCard.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe('none');

  // Настоящий dblclick доказывает frontend-блокировку и серверную идемпотентность вместе.
  await firstCard.getByRole('button', { name: 'Купить' }).dblclick();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Оплатить успешно' }).click();
  await expect(page.getByRole('heading', { name: 'Товар выдан' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.code-box strong')).toHaveText(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  await expect(page.locator('.history b', { hasText: 'delivered' })).toHaveCount(1);
  expect(browserErrors()).toEqual([]);
});

/** Проверяет, что все важные растровые assets загрузились, а не заменились broken-image значком. */
test('all visible storefront images load successfully', async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);
  await page.goto('/');
  await expect(page.locator('.product-card')).toHaveCount(5);
  const readImages = () =>
    page.locator('img').evaluateAll((elements) =>
      elements.map((element) => {
        const image = element as HTMLImageElement;
        return { src: image.currentSrc, complete: image.complete, width: image.naturalWidth };
      }),
    );
  // DOM появляется раньше сетевых PNG на удалённом HTTPS, поэтому ждём свойства самих изображений.
  await expect
    .poll(
      async () =>
        (await readImages())
          .filter((image) => !image.complete || image.width === 0)
          .map((image) => image.src),
      { timeout: 10_000, message: 'Все storefront assets должны завершить загрузку' },
    )
    .toEqual([]);
  const images = await readImages();
  expect(images.length).toBeGreaterThanOrEqual(15);
  expect(images.every((image) => image.complete && image.width > 0)).toBe(true);
  expect(browserErrors()).toEqual([]);
});

/** Проверяет минимальную поддерживаемую ширину на отсутствие горизонтального overflow. */
test('narrow viewport does not overflow horizontally', async ({ page }) => {
  const browserErrors = trackBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Каталог/ }).click();
  await expect(page.getByRole('navigation', { name: 'Каталог' })).toBeVisible();
  // Сравниваем геометрию корневого документа, а не субъективный screenshot.
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(browserErrors()).toEqual([]);
});
