import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { OrderDto, OrderStatus } from '@shop/api-client';
import { interval, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'app-order',
  imports: [RouterLink, DatePipe],
  templateUrl: './order.component.html',
  styleUrl: './order.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Страница заказа: polling read model, симуляция оплаты и показ выданного кода. */
export class OrderComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  readonly orderId = inject(ActivatedRoute).snapshot.paramMap.get('orderId') ?? '';
  readonly order = signal<OrderDto | null>(null);
  readonly actionPending = signal(false);
  readonly error = signal('');

  /** Запускает polling статуса и автоматически прекращает его при уничтожении компонента. */
  constructor() {
    // switchMap отменяет устаревший GET, если предыдущий ответ не успел прийти до нового тика.
    interval(650)
      .pipe(
        startWith(0),
        switchMap(() => this.http.get<OrderDto>(`/api/v1/orders/${this.orderId}`)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (order) => this.order.set(order),
        error: () => this.error.set('Заказ не найден или API недоступен'),
      });
  }

  /** Посылает команду учебному payment simulator и блокирует повторный клик до ответа. */
  simulate(status: 'paid' | 'failed'): void {
    if (this.actionPending()) return;
    this.actionPending.set(true);
    this.http.post('/api/v1/payments/simulate', { orderId: this.orderId, status }).subscribe({
      next: () => this.actionPending.set(false),
      error: () => {
        this.error.set('Не удалось отправить платёжное событие');
        this.actionPending.set(false);
      },
    });
  }

  /** Переводит машинный статус в понятную пользователю русскую формулировку. */
  label(status: OrderStatus): string {
    return (
      {
        created: 'Ожидает оплаты',
        paid: 'Оплата подтверждена',
        delivering: 'Получаем код',
        delivered: 'Товар выдан',
        payment_failed: 'Оплата не прошла',
        out_of_stock: 'Нет в наличии — можно восстановить',
        delivery_failed: 'Сбой выдачи — можно повторить',
      } satisfies Record<OrderStatus, string>
    )[status];
  }

  /** Форматирует целые копейки для показа, не участвуя в бизнес-расчётах. */
  money(minor: number): string {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(minor / 100);
  }
}
