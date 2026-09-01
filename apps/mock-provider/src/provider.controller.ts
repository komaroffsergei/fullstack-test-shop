import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { ProviderService } from './provider.service';

/** Входной контракт поставщика; request_id является ключом идемпотентности. */
class IssueDto {
  @IsUUID()
  request_id!: string;

  @IsString()
  sku!: string;

  @IsUUID()
  order_id!: string;
}

/** Тонкий HTTP-адаптер заглушки поставщика. */
@Controller()
export class ProviderController {
  /** Получает настроенный экземпляр ProviderService. */
  constructor(private readonly provider: ProviderService) {}

  /** Передаёт валидированную команду выдачи доменной логике заглушки. */
  @Post('issue')
  issue(@Body() input: IssueDto) {
    return this.provider.issue(input);
  }

  /** Возвращает здоровье и идентичность конкретного экземпляра A/B. */
  @Get('health')
  health() {
    return { status: 'ok', providerId: this.provider.providerId };
  }
}
