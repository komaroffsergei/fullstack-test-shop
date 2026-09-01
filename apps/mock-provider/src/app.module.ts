import { Module } from '@nestjs/common';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

@Module({ controllers: [ProviderController], providers: [ProviderService] })
/** Composition root одного экземпляра mock-provider. */
export class AppModule {}
