import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './app';
import { ConsoleSmsSender, SslWirelessSmsSender, type SmsSender } from './auth/sms';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

async function main() {
  const config = loadConfig();
  const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
  const sms: SmsSender =
    config.sms.provider === 'sslwireless'
      ? new SslWirelessSmsSender(config.sms)
      : new ConsoleSmsSender();
  const app = (await createApp({
    database,
    workerSeconds: config.workerSeconds,
    auth: { sms, settings: { secret: config.authSecret } },
    // Deposits, conversions and cash-outs are on unless MONEY_ENABLED=false.
    ...(config.money.enabled
      ? {
          money: {
            settings: config.money.settings,
            gateway: config.money.gateway,
            paymentsSecret: config.money.paymentsSecret,
            apiPublicUrl: config.money.apiPublicUrl,
            // Unpaid invoices expire after half an hour, like an e-wallet checkout window.
            invoiceValidityMinutes: 30,
          },
        }
      : {}),
  })) as NestExpressApplication;
  if (config.trustProxy) app.set('trust proxy', true);
  await app.listen(config.port);
  console.log(
    `Season Challenger API listening on http://localhost:${config.port} (${
      database ? 'Postgres' : 'in memory'
    }, sign-in codes via ${sms.name})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
