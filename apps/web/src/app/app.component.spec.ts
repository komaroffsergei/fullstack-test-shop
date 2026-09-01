import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  /** Проверяет, что standalone shell собирается с минимальным Router provider. */
  it('creates the Angular shell', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    expect(TestBed.createComponent(AppComponent).componentInstance).toBeTruthy();
  });
});
