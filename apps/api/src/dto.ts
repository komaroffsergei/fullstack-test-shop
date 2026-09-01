import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/** Вход создания заказа: клиент выбирает SKU, но не имеет права назначать цену. */
export class CreateOrderDto {
  /** Публичный UUID генерируется один раз на один purchase intent. */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  /** Сервер по SKU найдёт доверенные цену, валюту и товар. */
  @ApiProperty({ example: 'STEAM-TOPUP-500' })
  @IsString()
  sku!: string;

  /** Необязательный промокод будет нормализован и проверен в транзакции. */
  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  promoCode?: string;
}

/** Событие платёжной системы, которое сначала попадает в durable inbox. */
export class PaymentWebhookDto {
  /** Глобально уникальный ID защищает от повторной доставки одного события. */
  @ApiProperty({ example: 'evt_a1b2c3' })
  @IsString()
  event_id!: string;

  /** Ссылка на публичный UUID заказа; FK намеренно нет для ранних webhook. */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  order_id!: string;

  /** Поддерживаются успешный и неуспешный исход оплаты. */
  @ApiProperty({ enum: ['paid', 'failed'] })
  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';

  /** Сумма приходит в рублях и будет переведена в целые копейки. */
  @ApiProperty({ description: 'Amount in RUB major units', example: 500 })
  @IsInt()
  @Min(0)
  amount!: number;

  /** Валюта должна совпасть со снимком заказа. */
  @ApiProperty({ example: 'RUB' })
  @IsString()
  currency!: string;

  /** Время события отделено от времени его фактического получения. */
  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  created_at!: string;
}

/** Команда учебного симулятора оплаты. */
export class SimulatePaymentDto {
  @IsUUID()
  orderId!: string;

  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';
}

/** Запрос предварительного расчёта промокода без резервирования лимита. */
export class QuotePromoDto {
  @IsString()
  sku!: string;

  @IsString()
  promoCode!: string;
}

/** Административная команда пополнения пула ключей. */
export class AddProviderKeysDto {
  @IsIn(['A', 'B'])
  providerId!: 'A' | 'B';

  @IsString()
  sku!: string;

  @IsString({ each: true })
  codes!: string[];
}

/** Административная команда выбора детерминированного поведения mock-provider. */
export class ProviderModeDto {
  @IsIn(['A', 'B'])
  providerId!: 'A' | 'B';

  @IsIn(['success', 'out_of_stock', 'server_error_before_issue', 'timeout_after_issue'])
  mode!: 'success' | 'out_of_stock' | 'server_error_before_issue' | 'timeout_after_issue';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30_000)
  delayMs?: number;
}
