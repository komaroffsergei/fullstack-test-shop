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

type PurchaseIntent = { orderId: string; idempotencyKey: string; sku: string };

@Component({
  selector: 'app-storefront',
  imports: [RouterLink],
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Главная витрина: каталог, пять интерактивов и идемпотентное начало покупки. */
export class StorefrontComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;
  private purchaseIntent?: PurchaseIntent;

  readonly products = signal<ProductDto[]>([]);
  readonly loading = signal(true);
  readonly buying = signal<string | null>(null);
  readonly error = signal('');
  readonly menuOpen = signal(false);
  readonly activeSlide = signal(0);
  readonly currentSlide = computed(() => this.slides[this.activeSlide()] ?? this.slides[0]!);
  readonly currency = signal<'$' | '₸' | '₽'>('$');
  readonly visibleProducts = computed(() => this.products().slice(0, 5));

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

  /**
   * Создаёт один purchase intent и переиспользует его при повторном/двойном клике.
   * Новый UUID и Idempotency-Key появятся только при выборе другого SKU.
   */
  buy(sku: string): void {
    if (this.buying()) return;
    // Пара идентификаторов живёт дольше HTTP-попытки, поэтому retry безопасен.
    if (!this.purchaseIntent || this.purchaseIntent.sku !== sku) {
      this.purchaseIntent = {
        orderId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        sku,
      };
    }
    const intent = this.purchaseIntent;
    this.buying.set(sku);
    this.error.set('');
    // Браузер не отправляет цену: API вычислит её по SKU и серверному каталогу.
    this.http
      .post<OrderDto>(
        '/api/v1/orders',
        { orderId: intent.orderId, sku: intent.sku },
        { headers: { 'Idempotency-Key': intent.idempotencyKey } },
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

  /** Возвращает утверждённый общий asset карточки из макета. */
  productImage(): string {
    return '/assets/product-card.jpg';
  }
}
