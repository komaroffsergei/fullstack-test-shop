import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    // Lazy import уменьшает начальный bundle и загружает страницу только по маршруту.
    loadComponent: () => import('./storefront.component').then((m) => m.StorefrontComponent),
  },
  {
    path: 'orders/:orderId',
    loadComponent: () => import('./order.component').then((m) => m.OrderComponent),
  },
  { path: 'admin', loadComponent: () => import('./admin.component').then((m) => m.AdminComponent) },
  // Неизвестный адрес возвращает пользователя на витрину.
  { path: '**', redirectTo: '' },
];
