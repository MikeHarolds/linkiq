# QR Code Architecture

Sprint 4 adds a QR Code engine tightly integrated with LinkIQ's existing
link, redirect, and analytics infrastructure. This document covers it end
to end.

## 1. Core principle: a QR code is a view of a link, not a separate entity

A QR code always encodes an existing link's **short URL**
(`https://linkiq.example/abc123`) — never its `destinationUrl` directly.
This is the single most important architectural decision in this sprint,
and everything else follows from it:

- **The destination can change at any time without touching the QR
  code.** `LinksService.update()` changes `destinationUrl`; the short
  code (and therefore every QR code pointing at it) is untouched. A
  printed poster with a QR code stays valid forever, even if the
  marketing team redirects the campaign to a different landing page next
  week. Verified directly: an e2e test creates a QR code, downloads it,
  changes the link's destination, downloads again, and asserts the two
  PNGs are byte-identical.
- **No image bytes are stored anywhere.** A `QrCode` row is pure
  configuration (colors, size, error correction, margin) plus a
  reference to a link. PNG/SVG output is generated on demand, in
  low-single-digit milliseconds, fully deterministically from that
  configuration — there is nothing to keep in sync when a color is
  edited, and nothing to invalidate when a destination changes.
- **A QR code cannot exist without a link.** Enforced at the API level:
  QR codes are only ever created via `POST /links/:linkId/qrcodes`, and
  the link is validated (workspace membership, not soft-deleted) before
  any QR row is written.

## 2. Data model

```
QrCode
  id, workspaceId, linkId, name
  format (PNG | SVG)
  size, foregroundColor, backgroundColor, errorCorrectionLevel, margin
  createdById, createdAt, updatedAt, deletedAt
```

Indexed on `workspaceId`, `linkId`, and `createdById`. Foreign keys
cascade from `Workspace` and `Link` (deleting either removes their QR
codes); `createdById` is `SET NULL` on user deletion, matching the same
pattern already used for `Link.createdById`.

Soft-deleted like every other domain entity in LinkIQ (`deletedAt`, never
a hard `DELETE`).

## 3. Generation

`QrGeneratorService` wraps the `qrcode` npm package (pure JS, no native
dependencies, ~135KB) with exactly two operations: PNG bytes and SVG
markup, both from the same `(data, config)` inputs. It validates the
config (see §4) before generating, so an invalid configuration never
reaches the underlying library.

**No BullMQ queue for generation.** The Sprint 4 spec is explicit that
background processing should not be introduced "merely for complexity" —
generating a 512px QR code takes low single-digit milliseconds, well
within what's reasonable to do synchronously inside a request. If bulk/
batch generation is ever added, `QrGeneratorService` is already the one
seam that would move behind a queue; nothing else would need to change.

## 4. Validation

`validateQrConfig` (in `utils/qr-validation.ts`) checks:

- `size`: integer, 128–2000px (prevents both unreadably-tiny codes and
  resource-exhaustion via arbitrarily huge requested images)
- `margin`: integer, 0–20 modules
- `foregroundColor` / `backgroundColor`: valid hex (`#RGB` or `#RRGGBB`)
- **Foreground and background must differ.** This is the one check no
  single-field validator can catch, and it's applied against the
  _effective_ configuration — explicit values merged with schema
  defaults for anything omitted — both at creation and at update, not
  only at download time. (An earlier version of this code only checked
  this at download/generation time; a live test proved a QR code with
  identical colors could be _saved_ successfully. Fixed to validate at
  write time, with a regression test covering the specific edge case of
  an explicit color colliding with an _omitted_ field's default.)

The frontend's Zod schema mirrors these rules for immediate feedback;
the backend re-validates independently regardless of what the client
sends, exactly like every other form in LinkIQ.

## 5. Download system

`GET /qrcodes/:id/download` streams the generated image directly in the
response — `Content-Type: image/png` or `image/svg+xml`,
`Content-Disposition: attachment; filename="linkiq-<slug>-qr.png"` (the
filename is built from the QR's name via the same `slugify()` utility
used elsewhere in the codebase, so it can never contain path separators,
spaces, or other characters that would be unsafe in an HTTP header or a
downloaded file's name), and `Cache-Control: no-store` (a QR download
should never be cached by an intermediary, since the underlying link can
change).

An optional `?format=PNG|SVG` query param overrides the QR code's stored
default format for that one download, without changing the stored
record.

## 6. QR attribution — how scans are distinguished, without a second pipeline

The spec is explicit: _"Do not create a separate QR analytics pipeline."_
Here's the whole mechanism, and it requires zero changes to the redirect
path or the `ClickEvent` schema:

Every QR code encodes its short URL **with a fixed set of UTM query
parameters appended**:

```
https://linkiq.example/abc123?utm_source=qr_code&utm_medium=qr&utm_campaign=<slugified-qr-name>
```

Sprint 3's analytics pipeline _already_ parses and stores
`utm_source`/`utm_medium`/`utm_campaign` from the query string on every
redirect (`extractMarketingParams`, `ClickEvent.queryParams`) — with zero
special-casing for where those params come from. A QR scan is, from the
redirect engine's perspective, an ordinary GET request; it flows through
the exact same `RedirectService.resolve()` → `ClickEventProducer` →
BullMQ → `ClickEventProcessor` path as a browser click, a shared link, or
anything else. Verified directly: an e2e test simulates a scan and
asserts exactly one `ClickEvent` is created with
`queryParams.utm_source === 'qr_code'`.

**What this buys, today:** any future "QR-only" analytics view is a
one-line SQL filter (`queryParams->>'utm_source' = 'qr_code'`) against
data that's already being collected correctly — no migration, no new
processing path. This sprint does not build that filtered view (the spec
says not to fabricate QR-specific statistics before the ability to
compute them for real exists), but the plumbing is complete.

**Trade-off, stated plainly:** this means QR-originated clicks are
distinguished by the presence of specific UTM parameters, not by a
dedicated boolean/enum column. If a user manually adds the exact same
`utm_source=qr_code` to a hand-typed URL, it would be (correctly, if a
little surprisingly) indistinguishable from an actual scan. This is an
acceptable trade-off for "attribute QR traffic" without a second
tracking system, not a security or correctness gap — nothing sensitive
depends on this distinction being adversarially robust.

## 7. Authorization

Every QR endpoint requires `X-Workspace-Id` and goes through the
existing `WorkspaceRolesGuard`:

- **VIEWER**: read (`GET`) and download
- **MEMBER, ADMIN, OWNER**: full management (create, update, delete)

A QR code in a workspace the caller isn't a member of returns 404, not
403 — the same "don't confirm something exists in a workspace you can't
see" principle applied to Links and every other domain entity.

## 8. Security review

- **Input validation**: size/margin bounds and hex-color format checks
  prevent malformed or resource-exhausting requests (see §4).
- **Malicious color values**: colors are validated against a strict hex
  regex before ever reaching the `qrcode` library or an HTTP header —
  arbitrary strings (`"red; DROP TABLE..."`, `"<script>..."`) are
  rejected outright, covered by unit tests.
- **Path/filename safety**: download filenames are built exclusively
  from `slugify()` output plus a fixed suffix — never from raw user
  input, and never exposes any internal filesystem path.
- **Malformed ID parameters**: `ParseUUIDPipe` on every ID-shaped route
  param returns a clean 400 for a non-UUID input. (Found via a live test
  during this sprint: without it, a malformed ID reached the database
  layer and surfaced a raw SQL error as a 500 — fixed here, and the same
  pre-existing gap was found and fixed in `LinksController` too.)
- **Excessive QR generation / resource exhaustion**: bounded by the same
  rate limiting already applied globally (`ThrottlerGuard`, Sprint 1.1)
  plus the hard 128–2000px size ceiling, which caps the maximum work any
  single generation call can do.
- **No filesystem writes**: generation is fully in-memory; there is no
  local file storage to secure or clean up.

## 9. Storage strategy

No object storage (local disk or S3-compatible) is used or required —
see §1 and §5: nothing is persisted beyond the configuration row, and
every download is generated fresh from it. If a future requirement
demands serving pre-rendered assets (e.g. a CDN-fronted public QR image
URL), `QrGeneratorService`'s output (a `Buffer` or `string`) is already
in the right shape to hand to any storage abstraction without changing
its interface.

## 10. Future extensibility

- **QR-specific analytics view**: the UTM-based attribution (§6) is
  ready; only a filtered analytics query/UI needs to be added.
- **Logo overlay**: several seeded demo QR codes intentionally use high
  (`H`) error correction, which leaves enough redundancy for a future
  logo-in-the-middle feature without needing a schema change.
- **Bulk generation / a QR queue**: `QrGeneratorService` is the single
  seam that would move behind BullMQ if batch generation is ever added.
- **S3-compatible asset caching**: if generation ever becomes expensive
  enough to want to cache rendered output (unlikely at current
  complexity — see §3), the generator's return shape is already
  storage-agnostic.
