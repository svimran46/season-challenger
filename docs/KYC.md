# ID check (KYC)

Vouchers need an ID-verified player aged 18 or over, and one ID can verify one account. The
check gates voucher redemption only; signing in, coins and tournaments never need it.

## Player flow

1. The app's **Verify your ID** screen asks for the document type (national ID card or passport)
   and how it is photographed: **front and back** (two photos) or **single photo** (the whole
   document in one frame).
2. The player types their date of birth and the document number, adds the photos (camera or
   gallery) and submits. The submission waits for review; the screen shows its status.
3. A reviewer approves or rejects it. Approval verifies the player. Rejection shows the reason
   and the player can send new photos.

## HTTP API

All player routes need sign-in.

| Route                                | What it does                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/verification`            | Status: `{ status: 'unverified' \| 'pending' \| 'approved' \| 'rejected', verifiedAt, submission }` where `submission` is `{ id, documentType, layout, submittedAt, reviewedAt, rejectionReason } \| null` (the newest one).                                                                                      |
| `POST /v1/me/verification/documents` | `multipart/form-data`. Fields: `documentType` (`nid` \| `passport`), `layout` (`front_back` \| `single`), `birthDate` (YYYY-MM-DD), `documentNumber`. Files: `front` and `back` for `front_back`, `single` for `single`. JPEG, PNG, WebP or HEIC, up to 6 MB each. 201 returns the same body as the status route. |
| `POST /v1/me/verification`           | Development only (404 when `AUTH_MODE` is not `dev`): verifies at once from `{ birthDate, documentNumber }`, for tests and scripts.                                                                                                                                                                               |

Errors are `{ error, message }`: `already_verified` (409), `review_pending` (409),
`identity_in_use` (409, the ID verifies another account), `under_18` (422), `bad_image` (400),
`missing_image` (400).

### Reviewer routes

Need the header `x-reviewer-token: <KYC_REVIEWER_TOKEN>`; without the variable set they are off
(404). The review page at `/review` uses them.

| Route                                           | What it does                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /v1/review/verifications?status=pending`   | The queue, oldest first (`approved` / `rejected` for history).                                       |
| `GET /v1/review/verifications/:id`              | One submission, with the typed document number while it is pending.                                  |
| `GET /v1/review/verifications/:id/images/:side` | A photo (`front`, `back` or `single`), decrypted, `Cache-Control: no-store`.                         |
| `POST /v1/review/verifications/:id/approve`     | `{ reviewer, birthDate?, documentNumber? }`: verifies the player, optionally with corrected details. |
| `POST /v1/review/verifications/:id/reject`      | `{ reviewer, reason }`: the player sees the reason and can resubmit.                                 |

## Privacy and storage

- Photos are encrypted with AES-256-GCM (`KYC_ENCRYPTION_KEY`) before they are written. The
  storage backend is behind the `DocumentVault` interface: memory in development, a local
  directory with `KYC_STORAGE_DIR`. An object store (S3-compatible) is the next backend.
- The document number is kept only as a keyed hash on the player (`ID_HASH_SECRET`). The typed
  number is stored encrypted while the submission waits for review and wiped when it is decided.
- Photos are deleted `KYC_RETENTION_DAYS` after the decision (default 90); the worker does this.
- A real ID-check provider (Porichoy, Sumsub, Shufti Pro) can replace the manual reviewer later by
  calling the same approve and reject steps from its callback.
