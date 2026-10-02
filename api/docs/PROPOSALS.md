# Proposals

Part of the request marketplace (`REQUESTS_ENABLED`). See MARKETPLACE_REQUESTS.md
for the award flow.

## Data (`proposals`)

`request_id`, `professional_id`, optional `service_id` (one of the
professional's active gigs, or null = "Custom work"), `cover` (≥ 30 chars),
`price_kobo` (≥ ₦1,000), `delivery_days` (1–365), `milestones` JSON
(informational for now — projects/milestones ship in a later block),
`attachments` JSON (own media only), `proposed_start_at`, `status`,
`rejected_reason`.

**One live proposal per professional per request** is enforced in the
database with a partial unique index:

```sql
CREATE UNIQUE INDEX proposals_one_active_per_request
  ON proposals (request_id, professional_id)
  WHERE status IN ('submitted', 'accepted');
```

so a withdrawn or rejected proposal can be followed by a fresh one, but two
concurrent submits cannot both succeed (`409 PROPOSAL_EXISTS`).

## Lifecycle

```
submitted ──withdraw──▶ withdrawn
submitted ──customer reject / request closed / other proposal accepted──▶ rejected
submitted ──customer accept──▶ accepted (booking created)
```

* Only `submitted` proposals on an `open` request can be edited.
* Professionals cannot propose on their own requests, on non-open requests,
  or with a gig they do not own (`422` with field error).
* Price is copied to the booking at award time; later edits are impossible
  because the proposal is no longer `submitted`.

## Notifications (existing system)

`proposal.new` → customer; `proposal.accepted` / `proposal.rejected` /
`request.closed` → professional.
