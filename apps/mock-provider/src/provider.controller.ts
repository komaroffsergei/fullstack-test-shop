import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { ProviderService } from './provider.service';

class IssueDto {
  @IsUUID()
  request_id!: string;

  @IsString()
  sku!: string;

  @IsUUID()
  order_id!: string;
}

@Controller()
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  @Post('issue')
  issue(@Body() input: IssueDto) {
    return this.provider.issue(input);
  }

  @Get('health')
  health() {
    return { status: 'ok', providerId: this.provider.providerId };
  }
}
