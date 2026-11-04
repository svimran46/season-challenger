import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from './app';
import { GoogleIdTokenVerifier } from './auth/google';
import { ConsoleSmsSender, SslWirelessSmsSender, type SmsSender } from './auth/sms';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { DEV_KYC_KEY } from './kyc/kyc.module';
import { DiskBlobBackend, EncryptedVault, MemoryBlobBackend } from './kyc/vault';

async function main() {
  const config = loadConfig();
  const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
  const sms: SmsSender =
    config.sms.provider === 'sslwireless'
      ? new SslWirelessSmsSender(config.sms)
      : new ConsoleSmsSender();
  const kycKey = config.kyc.encryptionKey ?? DEV_KYC_KEY;
  const vault = config.kyc.storageDir
    ? new EncryptedVault(new DiskBlobBackend(config.kyc.storageDir), kycKey, 'disk')
    : new EncryptedVault(new MemoryBlobBackend(), kycKey, 'memory');
  const app = (await createApp({
    database,
    workerSeconds: config.workerSeconds,
    partner: { presentSecret: config.voucherPresentSecret },
    corsOrigins: config.portalOrigins,
    auth: {
      sms,
      settings: { secret: config.authSecret, phoneEnabled: config.phoneSignIn },
      google: config.googleWebClientId
        ? new GoogleIdTokenVerifier(config.googleWebClientId)
        : undefined,
    },
    kyc: {
      vault,
      settings: {
        sealKey: kycKey,
        reviewerToken: config.kyc.reviewerToken,
        retentionDays: config.kyc.retentionDays,
      },
    },
  })) as NestExpressApplication;
  if (config.trustProxy) app.set('trust proxy', true);
  await app.listen(config.port);
  console.log(
    `Season Challenger API listening on http://localhost:${config.port} (${
      database ? 'Postgres' : 'in memory'
    }; sign-in: ${[
      config.googleWebClientId ? 'Google' : '',
      config.phoneSignIn ? `phone codes via ${sms.name}` : '',
    ]
      .filter(Boolean)
      .join(', ')}; ID photos in ${vault.name}${
      config.kyc.reviewerToken ? ', ID review at /review' : ''
    })`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
