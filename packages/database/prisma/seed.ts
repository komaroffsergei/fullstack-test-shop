import { PrismaClient, ProviderId } from '@prisma/client';

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

const keys = [
  'LFXC-TNCS-BPCD',
  'P3EI-W8UO-9B4K',
  'FEL3-GUXN-TCCH',
  'YPLV-QK2Z-IUS5',
  '0K9E-P1FR-BY1U',
  '5LZV-UQ48-RXCZ',
  'X93K-NYAQ-GEC1',
  'EIO5-CQT5-35KO',
  'M58F-GIIR-VJAP',
  'NU8Y-SWYB-6252',
  'OODW-CCHF-MBAF',
  'DNA5-WFJM-NE49',
  'QRDD-MJ3F-A8TF',
  'TAT9-5ZJN-G1T2',
  'LI39-4330-ISMB',
  'BKJY-8Q79-8NHI',
  'HHW6-4RX2-DX62',
  '1RG2-L28O-O80G',
  'EF63-F39X-MTEA',
  '8XS7-P53H-JKIV',
  'JPE6-MQV6-P7ST',
  'SAPG-A2GR-0ULS',
  'T2DU-IJ1S-U16P',
  'WSSY-QTR7-Z57J',
  'U74E-EPCI-CY26',
  'FZXF-58H8-OR93',
  'FPSM-HLZA-TPAL',
  'WSC9-28DJ-B2JE',
  'P63J-F7UZ-DCYP',
  'C7W2-D4C5-QMT7',
  'JESI-DFBH-LK1K',
  'SGMA-JA0T-GR7D',
  '3PR4-OSY9-M3ZW',
  'OMBE-C0JF-D45Y',
  'KIKQ-FQJ8-9TI8',
  'LMAN-RSHS-AJDO',
  'BAKI-VT1X-Z5OL',
  '9F0X-B46W-03FS',
  'S423-V6YY-IBEM',
  'D4UW-WYRA-20ST',
  'XC0J-CJ0H-09RN',
  'RY1W-XCFJ-0KUA',
  'CJYY-YKSQ-QE6H',
  '97AQ-38QJ-H8HU',
  'FS8E-3S5Z-I6RA',
  'ARQK-FML4-A14E',
  '7Z6K-NO9V-MPJB',
  'D4K7-IJSG-N853',
  'W67T-ZB0Q-1XKB',
  '7EQM-K09J-XKUO',
];

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
