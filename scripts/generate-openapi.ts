/** Загружает живую OpenAPI-схему и проверяет наличие обязательных контрактов ТЗ. */
async function main(): Promise<void> {
  const url = process.env.OPENAPI_URL ?? 'http://127.0.0.1:4000/api/openapi.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenAPI endpoint returned ${response.status}`);
  const document = (await response.json()) as {
    paths?: Record<string, Record<string, unknown>>;
  };
  // Проверяем каждый публичный, административный и операционный контракт из матрицы ТЗ.
  const requiredOperations: Array<[string, string]> = [
    ['/api/v1/catalog/products', 'get'],
    ['/api/v1/orders', 'post'],
    ['/api/v1/orders/{orderId}', 'get'],
    ['/api/v1/payments/simulate', 'post'],
    ['/api/v1/webhooks/payment', 'post'],
    ['/api/v1/promocodes/quote', 'post'],
    ['/api/v1/admin/recovery/orders', 'get'],
    ['/api/v1/admin/orders/{orderId}/retry-delivery', 'post'],
    ['/api/v1/admin/providers/keys', 'post'],
    ['/api/v1/admin/providers/mode', 'post'],
    ['/api/v1/admin/demo/reset', 'post'],
    ['/api/health/live', 'get'],
    ['/api/health/ready', 'get'],
    ['/api/metrics', 'get'],
  ];
  for (const [path, method] of requiredOperations) {
    if (!document.paths?.[path]?.[method]) {
      throw new Error(`OpenAPI is missing ${method.toUpperCase()} ${path}`);
    }
  }
  console.log(`OpenAPI contract verified from ${url}`);
}

void main();
