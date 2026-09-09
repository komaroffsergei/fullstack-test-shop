import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { OrderDto, ProductDto } from '@shop/api-client';

type ProductFilter = 'all' | 'topup' | 'key' | 'subscription' | 'giftcard';
type PurchaseIntent = {
  orderId: string;
  idempotencyKey: string;
  sku: string;
  promoCode: string | null;
};
type PromoQuote = {
  basePriceMinor: number;
  discountMinor: number;
  finalPriceMinor: number;
  currency: string;
  remainingUses: number;
};

@Component({
  selector: 'app-storefront',
  imports: [RouterLink],
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Главная витрина: полный каталог задания, пять интерактивов и идемпотентная покупка. */
export class StorefrontComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;
  private purchaseIntent?: PurchaseIntent;

  readonly products = signal<ProductDto[]>([]);
  readonly loading = signal(true);
  readonly buying = signal<string | null>(null);
  readonly error = signal('');
  readonly demo = signal(false);
  readonly menuOpen = signal(false);
  readonly activeSlide = signal(0);
  readonly currentSlide = computed(() => this.slides[this.activeSlide()] ?? this.slides[0]!);
  readonly currency = signal<'$' | '₸' | '₽'>('$');
  readonly search = signal('');
  readonly productFilter = signal<ProductFilter>('all');
  readonly promoOpen = signal(false);
  readonly promoCode = signal('');
  readonly promoQuote = signal<PromoQuote | null>(null);
  readonly promoMessage = signal('');
  readonly quotePending = signal(false);
  readonly visibleProducts = computed(() => {
    const query = this.search().trim().toLocaleLowerCase('ru-RU');
    const filter = this.productFilter();
    return this.products().filter(
      (product) =>
        (filter === 'all' || product.type === filter) &&
        (!query ||
          product.name.toLocaleLowerCase('ru-RU').includes(query) ||
          product.sku.toLocaleLowerCase('en-US').includes(query)),
    );
  });

  readonly filters: ReadonlyArray<{ value: ProductFilter; label: string }> = [
    { value: 'all', label: 'Все товары' },
    { value: 'topup', label: 'Пополнения' },
    { value: 'key', label: 'Ключи' },
    { value: 'subscription', label: 'Подписки' },
    { value: 'giftcard', label: 'Подарочные карты' },
  ];

  readonly promoExamples = [
    { code: 'WELCOME10', value: '−10%', limit: '100 использований' },
    { code: 'GG500', value: '−500 ₽', limit: '20 использований' },
    { code: 'LIMIT3', value: '−25%', limit: '3 использования' },
    { code: 'ONCEONLY', value: '−50%', limit: '1 использование' },
  ] as const;

  readonly orderStatuses = [
    ['created', 'заказ создан, ожидает оплаты'],
    ['paid', 'оплата подтверждена, запускается выдача'],
    ['delivering', 'идёт получение кода у поставщика'],
    ['delivered', 'код выдан и привязан к заказу'],
    ['payment_failed', 'оплата не прошла'],
    ['out_of_stock', 'оплачено, но кода нет; заказ можно восстановить'],
    ['delivery_failed', 'оба поставщика не выдали код; доступен retry'],
  ] as const;

  readonly assignmentKeys = [
    'LFXC-TNCS-BPCD',
    'P3EI-W8UO-9B4K',
    'FEL3-GUXN-TCCH',
    'YPLV-QK2Z-IUS5',
    '0K9E-P1FR-BY1U',
    '5LZV-UQ48-RXCZ',
    'X93K-NYAQ-GEC1',
    'EIO5-CQT5-35KO',
    'M58F-GIIR-VJAP',
    'NU8Y-SWYB-6252',
    'OODW-CCHF-MBAF',
    'DNA5-WFJM-NE49',
    'QRDD-MJ3F-A8TF',
    'TAT9-5ZJN-G1T2',
    'LI39-4330-ISMB',
    'BKJY-8Q79-8NHI',
    'HHW6-4RX2-DX62',
    '1RG2-L28O-O80G',
    'EF63-F39X-MTEA',
    '8XS7-P53H-JKIV',
    'JPE6-MQV6-P7ST',
    'SAPG-A2GR-0ULS',
    'T2DU-IJ1S-U16P',
    'WSSY-QTR7-Z57J',
    'U74E-EPCI-CY26',
    'FZXF-58H8-OR93',
    'FPSM-HLZA-TPAL',
    'WSC9-28DJ-B2JE',
    'P63J-F7UZ-DCYP',
    'C7W2-D4C5-QMT7',
    'JESI-DFBH-LK1K',
    'SGMA-JA0T-GR7D',
    '3PR4-OSY9-M3ZW',
    'OMBE-C0JF-D45Y',
    'KIKQ-FQJ8-9TI8',
    'LMAN-RSHS-AJDO',
    'BAKI-VT1X-Z5OL',
    '9F0X-B46W-03FS',
    'S423-V6YY-IBEM',
    'D4UW-WYRA-20ST',
    'XC0J-CJ0H-09RN',
    'RY1W-XCFJ-0KUA',
    'CJYY-YKSQ-QE6H',
    '97AQ-38QJ-H8HU',
    'FS8E-3S5Z-I6RA',
    'ARQK-FML4-A14E',
    '7Z6K-NO9V-MPJB',
    'D4K7-IJSG-N853',
    'W67T-ZB0Q-1XKB',
    '7EQM-K09J-XKUO',
  ] as const;

  readonly webhookExample = `{
  "event_id": "evt_a1b2c3",
  "order_id": "ord_00123",
  "status": "paid",
  "amount": 500,
  "currency": "RUB",
  "created_at": "2025-01-01T12:00:00Z"
}`;

  readonly providerExample = `POST /issue
{
  "request_id": "req_00123-1",
  "sku": "STEAM-TOPUP-500",
  "order_id": "ord_00123"
}

200 OK
{
  "status": "ok",
  "request_id": "req_00123-1",
  "code": "LFXC-TNCS-BPCD"
}`;

  readonly slides = [
    {
      eyebrow: 'Быстрая выдача',
      title: 'Цифровые товары — сразу после оплаты',
      text: 'Один заказ. Один код. Даже при повторах и сбоях.',
    },
    {
      eyebrow: 'Steam',
      title: 'Пополняйте кошелёк без лишних шагов',
      text: 'Стоимость и скидка всегда считаются на сервере.',
    },
    {
      eyebrow: 'Надёжность',
      title: 'Покупка не потеряется при таймауте',
      text: 'Статус заказа и безопасное восстановление доступны в любой момент.',
    },
  ];

  readonly services = [
    ['Steam', '/assets/steam.png'],
    ['Telegram', '/assets/telegram.png'],
    ['Roblox', '/assets/roblox.png'],
    ['Brawl Stars', '/assets/brawl-stars.png'],
    ['PUBG Mobile', '/assets/pubg.png'],
    ['App Store', '/assets/app-store.png'],
    ['ChatGPT', '/assets/chatgpt.png'],
    ['PlayStation', '/assets/playstation.png'],
    ['TikTok', '/assets/tiktok.png'],
  ] as const;

  /** Загружает серверный каталог и запускает автоматическую смену hero-слайда. */
  ngOnInit(): void {
    this.http
      .get<{ enabled: boolean }>('/api/v1/demo/config')
      .subscribe({ next: (value) => this.demo.set(value.enabled) });
    // UI не содержит доверенных цен: карточки всегда строятся из ответа API.
    this.http.get<ProductDto[]>('/api/v1/catalog/products').subscribe({
      next: (products) => {
        this.products.set(products);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Каталог временно недоступен');
        this.loading.set(false);
      },
    });
    this.timer = setInterval(() => this.nextSlide(), 5_000);
  }

  /** Освобождает браузерный timer, когда пользователь покидает витрину. */
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Закрывает выпадающий каталог при клике вне меню. */
  @HostListener('document:click')
  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Переключает меню и не даёт document listener немедленно закрыть его. */
  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  /** Оставляет каталог открытым при взаимодействии внутри него. */
  keepMenuOpen(event: Event): void {
    event.stopPropagation();
  }

  /** Циклически выбирает следующий рекламный слайд. */
  nextSlide(): void {
    this.activeSlide.update((current) => (current + 1) % this.slides.length);
  }

  /** Циклически выбирает предыдущий рекламный слайд без отрицательного индекса. */
  previousSlide(): void {
    this.activeSlide.update((current) => (current - 1 + this.slides.length) % this.slides.length);
  }

  /** Фильтрует полный серверный каталог по названию или SKU без повторного HTTP-запроса. */
  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  /** Переключает одну из категорий, перечисленных в приложении к заданию. */
  setProductFilter(filter: ProductFilter): void {
    this.productFilter.set(filter);
  }

  /** Показывает или скрывает рабочую форму проверки промокода. */
  togglePromo(): void {
    this.promoOpen.update((open) => !open);
  }

  /** Обновляет поле промокода и сбрасывает устаревший предварительный расчёт. */
  setPromoCode(event: Event): void {
    this.promoCode.set((event.target as HTMLInputElement).value.toUpperCase());
    this.promoQuote.set(null);
    this.promoMessage.set('');
  }

  /** Подставляет один из четырёх промокодов из приложения к заданию и проверяет его на API. */
  usePromo(code: string): void {
    this.promoCode.set(code);
    this.quotePromo();
  }

  /** Получает серверный расчёт для STEAM-TOPUP-500, не расходуя лимит промокода. */
  quotePromo(): void {
    const promoCode = this.promoCode().trim().toUpperCase();
    if (!promoCode || this.quotePending()) return;
    this.quotePending.set(true);
    this.promoMessage.set('');
    this.http
      .post<PromoQuote>('/api/v1/promocodes/quote', {
        sku: 'STEAM-TOPUP-500',
        promoCode,
      })
      .subscribe({
        next: (quote) => {
          this.promoQuote.set(quote);
          this.promoMessage.set(`Промокод применится к заказу. Осталось: ${quote.remainingUses}`);
          this.quotePending.set(false);
        },
        error: () => {
          this.promoQuote.set(null);
          this.promoMessage.set('Промокод недоступен или его лимит уже исчерпан');
          this.quotePending.set(false);
        },
      });
  }

  /**
   * Создаёт один purchase intent и переиспользует его при повторном/двойном клике.
   * Новый UUID и Idempotency-Key появятся только при выборе другого SKU или промокода.
   */
  buy(sku: string, recovery = false): void {
    if (this.buying()) return;
    const promoCode = this.promoCode().trim().toUpperCase() || null;
    // Пара идентификаторов живёт дольше HTTP-попытки, поэтому retry безопасен.
    if (
      !this.purchaseIntent ||
      this.purchaseIntent.sku !== sku ||
      this.purchaseIntent.promoCode !== promoCode
    ) {
      this.purchaseIntent = {
        orderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        sku,
        promoCode,
      };
    }
    const intent = this.purchaseIntent;
    this.buying.set(sku);
    this.error.set('');
    // Браузер не отправляет цену: API вычислит её по SKU и серверному каталогу.
    this.http
      .post<OrderDto>(
        '/api/v1/orders',
        {
          orderId: intent.orderId,
          sku: intent.sku,
          ...(intent.promoCode ? { promoCode: intent.promoCode } : {}),
        },
        {
          headers: {
            'Idempotency-Key': intent.idempotencyKey,
            ...(recovery ? { 'X-Demo-Scenario': 'recovery' } : {}),
          },
        },
      )
      .subscribe({
        next: (order) => void this.router.navigate(['/orders', order.orderId]),
        error: () => {
          // Intent сохраняется: следующий клик повторит тот же безопасный запрос.
          this.error.set('Не удалось создать заказ. Повторите попытку — заказ не задвоится.');
          this.buying.set(null);
        },
      });
  }

  /** Нормализует путь изображения, который приходит из серверного каталога задания. */
  productImage(product: ProductDto): string {
    return product.image.startsWith('/') ? product.image : `/${product.image}`;
  }

  /** Переводит машинный тип товара из приложения к заданию в подпись карточки. */
  productType(type: string): string {
    return (
      {
        topup: 'Пополнение',
        key: 'Ключ',
        subscription: 'Подписка',
        giftcard: 'Подарочная карта',
      }[type] ?? type
    );
  }
}
