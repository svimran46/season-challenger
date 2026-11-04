# Releasing Season Challenger

How to put the API, the partner portal and the Android app in front of people. No hosting
provider has been chosen, so these steps work on any server that can run Node 22 or Docker.

## What has been tested

| Step                                               | Status                                     |
| -------------------------------------------------- | ------------------------------------------ |
| Migrating an empty database with `dist/migrate.js` | Run, twice in a row                        |
| Starting the built API with production settings    | Run; it answers and refuses `x-user-id`    |
| Building the Docker image                          | CI builds it; the image has never been run |
| Building the APK with EAS                          | **Never run**                              |
| Deploying anywhere                                 | **Never run**                              |

## API

### 1. Set the environment

| Variable                 | What it is                                                           |
| ------------------------ | -------------------------------------------------------------------- |
| `NODE_ENV`               | `production`                                                         |
| `DATABASE_URL`           | Postgres 16                                                          |
| `AUTH_SECRET`            | Random, 32+ characters                                               |
| `ID_HASH_SECRET`         | Random, 32+ characters. Never change it once ID checks exist         |
| `VOUCHER_PRESENT_SECRET` | Random, 32+ characters                                               |
| `KYC_ENCRYPTION_KEY`     | `openssl rand -base64 32`. Losing it loses every stored ID photo     |
| `KYC_STORAGE_DIR`        | A directory on a disk that survives restarts                         |
| `KYC_REVIEWER_TOKEN`     | Random, 32+ characters. Unset turns ID review off                    |
| `GOOGLE_WEB_CLIENT_ID`   | Turns on Google sign-in                                              |
| `SMS_PROVIDER`           | `sslwireless`, with `SSLWIRELESS_API_TOKEN` and `SSLWIRELESS_SID`    |
| `PORTAL_ORIGINS`         | The partner portal's address, such as `https://partners.example.com` |
| `TRUST_PROXY`            | `true` behind a load balancer, so rate limits see real addresses     |

Production refuses to start if a required value is missing, and says which. It needs at least one
way to sign in: Google or a real SMS provider.

`FOOTBALL_FEED` only supports `fake` so far, a made-up league. A real launch needs a data provider.

### 2. Migrate, then start

Run migrations before each release. Running them twice is safe, and two deploys take turns.

```bash
pnpm install --frozen-lockfile
pnpm --filter @season/api build
pnpm --filter @season/api db:deploy
pnpm --filter @season/api start
```

With Docker, from the repository root:

```bash
docker build -f apps/api/Dockerfile -t season-api .
docker run --env-file prod.env season-api node dist/migrate.js
docker run --env-file prod.env -p 3000:3000 -v season-kyc:/data/kyc season-api
```

Point `KYC_STORAGE_DIR` at the mounted volume (`/data/kyc` here). Check `GET /health` afterwards.
Serve the API over HTTPS, usually through the host's proxy.

### 3. Add partners

See "Partner portal" in [DEVELOPMENT.md](DEVELOPMENT.md).

## Partner portal

A static site. Build it with the API's address, then host `apps/portal/dist` anywhere that serves
HTTPS. Add its address to `PORTAL_ORIGINS`.

```bash
VITE_API_URL=https://api.example.com pnpm --filter @season/portal build
```

## Android APK

The app is shared directly as an APK, not through a store. You need a free [Expo](https://expo.dev)
account.

1. Install the tool and sign in: `npm install --global eas-cli`, then `eas login`.
2. In `apps/mobile`, set the API address for the build as `EXPO_PUBLIC_API_URL` on the `preview`
   profile in `eas.json`. It must be `https://`; Android blocks plain `http` by default.
3. Run `eas build --platform android --profile preview`. Let EAS create the signing key the first
   time, and download a copy of it with `eas credentials`. **If that key is lost, phones cannot
   update to a new build and people must uninstall first.**
4. Download the APK from the link EAS gives you and test it on a real phone before sharing.

For each new release, raise `version` and `android.versionCode` in `app.json`.

## Still missing

- **Updates:** nothing tells people a new APK exists, so they stay on the old one until told.
- **App icon:** the app uses the default Expo icon.
- **Error monitoring:** errors only reach the server log.
- **Backups:** set up Postgres backups and copy `KYC_STORAGE_DIR` with the host you choose.
- **Rate limits:** they count per API process, so several instances each keep their own count.
