import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Standalone bootstrap не требует классического Angular NgModule.
bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => console.error(error));
