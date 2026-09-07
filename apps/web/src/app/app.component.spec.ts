import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  /** Проверяет, что standalone shell собирается с минимальным Router provider. */
  it('creates the Angular shell', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/demo/config').flush({ enabled: true });
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Демонстрационный режим: используются моки',
    );
    http.verify();
  });
});
