import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'STEAM-TOPUP-500' })
  @IsString()
  sku!: string;

  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  promoCode?: string;
}

export class PaymentWebhookDto {
  @ApiProperty({ example: 'evt_a1b2c3' })
  @IsString()
  event_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  order_id!: string;

  @ApiProperty({ enum: ['paid', 'failed'] })
  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';

  @ApiProperty({ description: 'Amount in RUB major units', example: 500 })
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiProperty({ example: 'RUB' })
  @IsString()
  currency!: string;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  created_at!: string;
}

export class SimulatePaymentDto {
  @IsUUID()
  orderId!: string;

  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';
}

export class QuotePromoDto {
  @IsString()
  sku!: string;

  @IsString()
  promoCode!: string;
}

export class AddProviderKeysDto {
  @IsIn(['A', 'B'])
  providerId!: 'A' | 'B';

  @IsString()
  sku!: string;

  @IsString({ each: true })
  codes!: string[];
}

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
