import { PrismaClient, ProviderId } from '@prisma/client';
import { INITIAL_PROVIDER_KEYS } from '../src/demo-data.js';

const prisma = new PrismaClient();

const products = [
  ['STEAM-TOPUP-500', 'Пополнение Steam 500 ₽', 'topup', 50_000, 'assets/steam.png'],
  ['STEAM-TOPUP-1000', 'Пополнение Steam 1000 ₽', 'topup', 100_000, 'assets/steam.png'],
  ['STEAM-TOPUP-2500', 'Пополнение Steam 2500 ₽', 'topup', 250_000, 'assets/steam.png'],
  ['KEY-CS2-PRIME', 'CS2 Prime Status ключ', 'key', 129_000, 'assets/cs2.png'],
  ['KEY-GTA5', 'GTA V ключ активации', 'key', 199_000, 'assets/gta5.png'],
  ['KEY-EFT', 'Escape from Tarkov ключ', 'key', 349_000, 'assets/eft.png'],
  ['SUB-DISCORD-1M', 'Discord Nitro 1 месяц', 'subscription', 39_900, 'assets/discord.png'],
  ['SUB-YT-3M', 'YouTube Premium 3 месяца', 'subscription', 149_000, 'assets/youtube.png'],
  ['SUB-SPOTIFY-1M', 'Spotify Premium 1 месяц', 'subscription', 29_900, 'assets/spotify.png'],
  ['GIFT-PSN-1000', 'PlayStation Store карта 1000 ₽', 'giftcard', 100_000, 'assets/psn.png'],
  ['GIFT-XBOX-1500', 'Xbox Gift Card 1500 ₽', 'giftcard', 150_000, 'assets/xbox.png'],
  ['GIFT-ROBLOX-800', 'Roblox 800 Robux', 'giftcard', 89_000, 'assets/roblox.png'],
] as const;

const keys = INITIAL_PROVIDER_KEYS;

async function seed(): Promise<void> {
  for (const [sku, name, type, priceMinor, image] of products) {
    await prisma.product.upsert({
      where: { sku },
      update: { name, type, priceMinor, currency: 'RUB', image, active: true },
      create: { sku, name, type, priceMinor, currency: 'RUB', image, active: true },
    });
  }

  const promos = [
    { code: 'WELCOME10', type: 'percent' as const, value: 10, maxUses: 100 },
    { code: 'GG500', type: 'amount' as const, value: 50_000, currency: 'RUB', maxUses: 20 },
    { code: 'LIMIT3', type: 'percent' as const, value: 25, maxUses: 3 },
    { code: 'ONCEONLY', type: 'percent' as const, value: 50, maxUses: 1 },
  ];
  for (const promo of promos) {
    await prisma.promocode.upsert({
      where: { code: promo.code },
      update: { ...promo, active: true },
      create: promo,
    });
  }

  for (const providerId of [ProviderId.A, ProviderId.B]) {
    await prisma.providerSetting.upsert({
      where: { providerId },
      update: { faultMode: 'success', delayMs: 1500 },
      create: { providerId, faultMode: 'success', delayMs: 1500 },
    });
  }

  for (const [index, code] of keys.entries()) {
    const providerId = index % 2 === 0 ? ProviderId.A : ProviderId.B;
    await prisma.providerKey.upsert({
      where: { code },
      update: {},
      create: { providerId, sku: 'STEAM-TOPUP-500', code },
    });
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
