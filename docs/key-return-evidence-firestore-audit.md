# Key Return Evidence Firestore Audit

Target: the Standard-edition `(default)` database in `securityprojectv1-staging`.

## Existing model and access

- `keyLogs/{keyLogId}` is queried by `site_id`, and the active list also filters
  `status == "ถูกเบิก"`.
- Checkout creates a KeyLog and `auditLogs/KEY_CHECKOUT_{keyLogId}` atomically.
- Return reads the KeyLog, updates it, and creates
  `auditLogs/KEY_RETURN_{keyLogId}` atomically.
- Existing checkout evidence fields are `borrower_photo_url` and
  `signature_image_url`; they must remain immutable during return.
- No existing return-evidence fields or media-type aliases were found.

## Return evidence extension

- `return_photo_url`: required non-empty private media reference on return.
- `return_signature_url`: required non-empty private media reference on return.
- `key_return`: canonical return-photo media type.
- `sig_key_return`: canonical return-signature media type.

Rules enforce the state transition, presence, type, size, server timestamps,
same-site access, immutable checkout identity, and atomic Key audit linkage.
The authenticated upload endpoint enforces module/site/record/media identity.
The private read endpoint revalidates the registered metadata, linked KeyLog,
Drive app properties, and file identity.

No new collection, query, index, public Drive permission, or client timestamp
is introduced.
