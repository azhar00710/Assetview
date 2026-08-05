# Integrator Guide (v1)

## 1) Integration sequence

1. Register tenant module client credentials.
2. Create a change package with source metadata and scope.
3. Upload/attach artifacts.
4. Submit package and monitor pipeline status.
5. Resolve conflicts and provide identity decisions.
6. Wait for approvals and published event.
7. Pull updated master data using API or event checkpointing.

## 2) Minimal REST flow

```http
POST /api/v1/change-packages
POST /api/v1/change-packages/{packageId}/submit
POST /api/v1/change-packages/{packageId}/validate
POST /api/v1/change-packages/{packageId}/map
POST /api/v1/change-packages/{packageId}/approvals
POST /api/v1/change-packages/{packageId}/inject
POST /api/v1/change-packages/{packageId}/publish
```

## 3) Event-driven flow

Subscribe to key events:

- `ceh.v1.<tenant>.change_package.submitted`
- `ceh.v1.<tenant>.change_package.approved`
- `ceh.v1.<tenant>.change_package.published`
- `ceh.v1.<tenant>.master.tag.updated`
- `ceh.v1.<tenant>.impact.high`

## 4) Idempotency and replay

- Send `Idempotency-Key` header for create/submit/inject endpoints.
- Persist `last_event_id` checkpoints on consumer side.
- Use `/sync/satellites/{satelliteId}/checkpoints` to coordinate replay-safe sync.

## 5) Security requirements

- OAuth2 client credentials or mTLS for system-to-system calls.
- Least-privilege scopes by module capability.
- Signed webhook payload validation for event consumers.

