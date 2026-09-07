import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `@if (demo()) {
      <aside class="demo">
        <strong>Демонстрационный режим: используются моки</strong>
        <p>
          Оплата и поставщики — моки, деньги не списываются. Angular, NestJS, PostgreSQL, webhook,
          очередь и выдача работают реально. Заказы видны только в вашей сессии и удаляются через
          час. <button (click)="reset()">Сбросить мой пример</button>
        </p>
        <span role="status">{{ message() }}</span>
      </aside>
    }
    <router-outlet />`,
  styles: [
    `
      .demo {
        background: #e9f0ff;
        color: #15274a;
        padding: 16px max(20px, calc((100vw - 1240px) / 2));
        font: 14px/1.5 sans-serif;
      }
      .demo p {
        margin: 6px 0;
      }
      .demo button {
        border: 1px solid #4363af;
        background: white;
        padding: 5px 10px;
        border-radius: 6px;
        cursor: pointer;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
/** Минимальная корневая оболочка, в которую Angular Router монтирует текущую страницу. */
export class AppComponent {
  private readonly http = inject(HttpClient);
  readonly demo = signal(false);
  readonly message = signal('');
  /** Читает серверный флаг демо, не меняя обычную эксплуатацию приложения. */
  constructor() {
    this.http
      .get<{ enabled: boolean }>('/api/v1/demo/config')
      .subscribe({ next: (value) => this.demo.set(value.enabled) });
  }
  /** Удаляет только заказы текущей подписанной сессии. */
  reset(): void {
    this.http.post('/api/v1/demo/reset', {}).subscribe({
      next: () => {
        window.location.href = '/';
      },
      error: () => this.message.set('Дождитесь завершения выдачи и повторите сброс'),
    });
  }
}
