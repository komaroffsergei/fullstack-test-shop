import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./storefront.component').then((m) => m.StorefrontComponent),
  },
  {
    path: 'orders/:orderId',
    loadComponent: () => import('./order.component').then((m) => m.OrderComponent),
  },
  { path: 'admin', loadComponent: () => import('./admin.component').then((m) => m.AdminComponent) },
  { path: '**', redirectTo: '' },
];
