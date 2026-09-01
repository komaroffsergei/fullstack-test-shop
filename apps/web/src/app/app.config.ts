import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Глобальные ошибки браузера попадают в стандартный Angular error pipeline.
    provideBrowserGlobalErrorListeners(),
    // Signals позволяют работать без zone.js и лишних циклов change detection.
    provideZonelessChangeDetection(),
    // HttpClient и Router регистрируются на уровне standalone-приложения.
    provideHttpClient(),
    provideRouter(routes),
  ],
};
