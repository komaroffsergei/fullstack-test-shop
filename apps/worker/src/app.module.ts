import { Module } from '@nestjs/common';
import { WorkerService } from './worker.service';

@Module({ providers: [WorkerService] })
/** Composition root фонового процесса: HTTP-контроллеры ему не нужны. */
export class AppModule {}
