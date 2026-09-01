/** Загружает живую OpenAPI-схему и проверяет наличие обязательных контрактов ТЗ. */
async function main(): Promise<void> {
  const url = process.env.OPENAPI_URL ?? 'http://127.0.0.1:4000/api/openapi.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenAPI endpoint returned ${response.status}`);
  const document = (await response.json()) as { paths?: Record<string, unknown> };
  // Такой smoke-check не даёт случайно удалить ключевые endpoints при рефакторинге.
  for (const required of [
    '/api/v1/orders',
    '/api/v1/webhooks/payment',
    '/api/v1/catalog/products',
  ]) {
    if (!document.paths?.[required]) throw new Error(`OpenAPI is missing ${required}`);
  }
  console.log(`OpenAPI contract verified from ${url}`);
}

void main();
