import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type RecoveryOrder = { orderId: string; sku: string; status: string; updatedAt: string };

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Учебная админка восстановления, пополнения ключей и управления отказами. */
export class AdminComponent {
  private readonly http = inject(HttpClient);
  token = '';
  provider: 'A' | 'B' = 'A';
  mode = 'success';
  codes = '';
  readonly orders = signal<RecoveryOrder[]>([]);
  readonly message = signal('Введите серверный admin token. Он не сохраняется.');
  /** Создаёт заголовок авторизации только в памяти для текущего запроса. */
  private headers(): HttpHeaders {
    return new HttpHeaders({ 'X-Admin-Token': this.token });
  }

  /** Загружает список оплаченных, но не выданных заказов. */
  load(): void {
    this.http
      .get<RecoveryOrder[]>('/api/v1/admin/recovery/orders', { headers: this.headers() })
      .subscribe({
        next: (orders) => {
          this.orders.set(orders);
          this.message.set(`Восстановимых заказов: ${orders.length}`);
        },
        error: () => this.message.set('Доступ запрещён или API недоступен'),
      });
  }

  /** Ставит существующую job заказа на безопасный повтор и обновляет список. */
  retry(orderId: string): void {
    this.http
      .post(`/api/v1/admin/orders/${orderId}/retry-delivery`, {}, { headers: this.headers() })
      .subscribe({
        next: () => {
          this.message.set('Повторная выдача поставлена в очередь');
          // Небольшая пауза даёт worker'у время изменить состояние до повторного чтения.
          setTimeout(() => this.load(), 700);
        },
        error: () => this.message.set('Не удалось повторить выдачу'),
      });
  }

  /** Переключает детерминированный fault mode выбранного поставщика. */
  setMode(): void {
    this.http
      .post(
        '/api/v1/admin/providers/mode',
        { providerId: this.provider, mode: this.mode, delayMs: 1500 },
        { headers: this.headers() },
      )
      .subscribe({
        next: () => this.message.set(`Provider ${this.provider}: ${this.mode}`),
        error: () => this.message.set('Не удалось изменить режим'),
      });
  }

  /** Нормализует ввод из textarea и отправляет непустые коды в пул поставщика. */
  addKeys(): void {
    // Администратор может разделять коды запятыми или переносами строк.
    const codes = this.codes
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    this.http
      .post<{
        added: number;
      }>(
        '/api/v1/admin/providers/keys',
        { providerId: this.provider, sku: 'STEAM-TOPUP-500', codes },
        { headers: this.headers() },
      )
      .subscribe({
        next: (result) => {
          this.message.set(`Добавлено ключей: ${result.added}`);
          this.codes = '';
        },
        error: () => this.message.set('Не удалось добавить ключи'),
      });
  }

  /** После явного подтверждения просит API восстановить исходные демо-данные. */
  reset(): void {
    if (!confirm('Сбросить все демо-заказы и использование промокодов?')) return;
    this.http.post('/api/v1/admin/demo/reset', {}, { headers: this.headers() }).subscribe({
      next: () => {
        this.message.set('Демо-данные сброшены');
        this.load();
      },
      error: () => this.message.set('Сброс отклонён: возможно, worker обрабатывает заказ'),
    });
  }
}
