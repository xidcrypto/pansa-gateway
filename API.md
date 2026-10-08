# Panduan Integrasi Frontend — Baileys Gateway (multi-user)

Base URL: `http://localhost:3000`.
Coba interaktif: **`GET /docs`** (Swagger UI). Spec mentah: **`GET /openapi.json`**.

Semua request (kecuali `/health`, `/docs`, `/openapi.json`, `/auth/login`) wajib header:

```
Authorization: Bearer <token>
```

Master server-to-server (opsional, kalau `API_KEY` diset): `x-api-key: ...` = akses admin penuh.

## 1. Auth

```bash
POST /auth/login { "username": "budi", "password": "..." }
→ { "success": true, "token": "eyJ...", "user": { "id": 2, "username": "budi", "role": "user" } }
```

- Token disimpan di frontend (memory/localStorage), dikirim sebagai Bearer tiap request.
  Default kedaluwarsa 7 hari (`JWT_EXPIRES_IN`).
- `GET /auth/me` — profil + webhook sendiri.
- `PATCH /auth/me { "webhookUrl": "https://...", "webhookSecret": "..." }` — user atur
  webhook penerimanya sendiri (event session miliknya dikirim ke sini).
- `PATCH /auth/password { "oldPassword": "...", "newPassword": "..." }`.

Admin (`role: admin`) kelola user:

```bash
POST   /auth/users { "username": "budi", "password": "min6char", "role": "user" }
GET    /auth/users
PATCH  /auth/users/2 { "password": "...", "role": "admin", "active": false }
DELETE /auth/users/2
```

## 2. Session = 1 koneksi WA per user

```bash
# Bikin (owner otomatis = user yang login; admin boleh titip ownerId)
POST /sessions { "label": "HP Toko" }     # label opsional
→ { "success": true, "id": "<uuid>", "status": "connecting", "ownerId": 2 }
```

Login (pilih salah satu), polling status tiap 2–3 detik:

```bash
# QR
GET /sessions/<uuid>/qr        → { "status": "qr", "qr": "data:image/png;base64,..." }
# tampilkan <img src="qr">, user scan dari WA > Perangkat Tertaut

# ATAU pairing code (code custom 8 char A-Z/0-9 dari frontend kamu; kosong = random WA)
POST /sessions/<uuid>/pair { "phone": "6281234567890", "code": "TOKOKU01" }
→ { "success": true, "pairingCode": "TOKOKU01", "custom": true }
# user ketik di WA > Perangkat Tertaut > Tautkan dengan nomor telepon
# 1 kode aktif per session; ganti = POST /sessions/<uuid>/pair/cancel dulu

GET /sessions/<uuid>/status
→ { "status": "open", "me": { "id": "628..@s.whatsapp.net", "name": "..." } }
```

`GET /sessions` = daftar session **milik user yang login** (admin lihat semua + nama owner).

Cabut: `POST /sessions/<uuid>/stop` / `{ "logout": true }` (keluar dari HP juga).
Ganti label: `PATCH /sessions/<uuid> { "label": "HP Baru" }`.

Status: `connecting | qr | pairing | open | close (auto-reconnect) | logged_out (login ulang)`.

## 3. Kirim pesan

```bash
POST /sessions/<uuid>/send/text { "to": "6281234567890", "text": "Halo!" }
→ { "success": true, "messageId": "3EB0...", "to": "628..@s.whatsapp.net" }
```

`to`: nomor (`628..`), JID, atau grup (`xxx@g.us`).

Button (reply/url/copy/call/reminder/address/location):

```bash
POST /sessions/<uuid>/send/button
{
  "to": "6281234567890", "title": "Menu", "body": "Pilih:", "footer": "Bot",
  "buttons": [
    { "kind": "reply", "text": "Cek Saldo", "id": "saldo" },
    { "kind": "url", "text": "Website", "url": "https://example.com" },
    { "kind": "copy", "text": "Salin VA", "code": "8800123456" },
    { "kind": "call", "text": "CS", "id": "6281234567890" }
  ]
}
```

List:

```bash
POST /sessions/<uuid>/send/list
{ "to": "...", "body": "Pilih menu:", "buttonText": "Buka",
  "sections": [{ "title": "Utama",
    "rows": [{ "title": "Profil", "description": "Buka profil", "id": "profile" }] }] }
```

Media — `media` = salah satu (bisa string URL langsung):

```json
{ "url": "https://..." } { "base64": "..." }
{ "dataUri": "data:image/jpeg;base64,..." } { "path": "upload/abc.jpg" }
```

- `POST .../send/image { "to", "caption?", "media" }`
- `POST .../send/video { "to", "caption?", "media", "gifPlayback?" }`
- `POST .../send/audio { "to", "media", "ptt?" }` (vn: `ptt: true`)
- `POST .../send/document { "to", "filename?", "media" }`
- `POST .../send/sticker|location|contact|poll|carousel|buttonv2` (lihat `/docs`)

> `media.url`: host internal (localhost, IP privat, metadata cloud) **ditolak** (anti-SSRF).
> `media.path`: hanya file di dalam `MEDIA_DIR` server. Upload file user → kirim sebagai
> `base64`/`dataUri` saja.

Kelola: `POST .../react { to, messageId, emoji }`, `.../delete`, `.../edit { text }`,
`.../forward { to, messageId, content }` (content dari webhook), `.../read { to, messageIds[] }`.
Riwayat (dari MySQL): `GET .../messages/incoming?limit=20`, `.../messages/outgoing?limit=20`.

Grup: `GET/POST .../groups`, `GET/PATCH .../groups/:jid`, `.../:jid/leave`,
`.../:jid/participants { action: add|remove|promote|demote, participants[] }`,
`.../:jid/invite`, `.../join { code|link }`, `.../settings`, `.../ephemeral`, `.../requests`.
(JID grup di URL harus di-encode: `@` → `%40`.)

Util: `POST .../presence`, `POST .../check { phones[] }`, `GET .../avatar/:phone`,
`GET/POST/DELETE .../profile*`, `GET .../blocklist`, `POST .../download { message }`.

## 4. Webhook (pesan masuk → frontend kamu)

Set per user (`PATCH /auth/me`) atau global (`WEBHOOK_URL` di `.env`).
Event di-POST sebagai `{ "event", "session", "ts", "data" }`:

| event | data |
|---|---|
| `message.received` | `{ id, remoteJid, type, text, buttonResponse, quoted, hasMedia, pushName, timestamp }` |
| `message.status` | `{ id, remoteJid, status }` |
| `qr` | `{ qr }` |
| `connected` / `disconnected` / `logged_out` / `stopped` | `{ me? / code? }` |
| `presence`, `group.*`, `call` | payload masing-masing |

`buttonResponse` = id tombol yang diklik user. Header `x-webhook-secret` dikirim kalau diset.

Receiver contoh (Express):

```js
app.post('/wa/hook', express.json(), (req, res) => {
  if (req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) return res.sendStatus(401);
  const { event, session, data } = req.body;
  if (event === 'message.received')
    console.log(`[${session}] ${data.remoteJid}: ${data.text ?? data.buttonResponse}`);
  res.sendStatus(200);
});
```

## 5. Contoh kode

### JS: login → session → pairing → kirim

```js
const GW = 'http://localhost:3000';
const { token } = await fetch(`${GW}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'budi', password: '...' }),
}).then(r => r.json());
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const { id } = await fetch(`${GW}/sessions`, { method: 'POST', headers: H }).then(r => r.json());
const { pairingCode } = await fetch(`${GW}/sessions/${id}/pair`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ phone: '6281234567890', code: 'TOKOKU01' }),
}).then(r => r.json());
// tampilkan pairingCode ke user...

await fetch(`${GW}/sessions/${id}/send/text`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ to: '6281234567890', text: 'Halo!' }),
});
```

### PHP: kirim button

```php
$H = ['Content-Type: application/json', 'Authorization: Bearer '.$token];
$payload = json_encode(['to' => '6281234567890', 'body' => 'Pilih:', 'buttons' => [
  ['kind' => 'reply', 'text' => 'Ya', 'id' => 'yes'],
  ['kind' => 'reply', 'text' => 'Tidak', 'id' => 'no'],
]]);
$ch = curl_init("$gw/sessions/$id/send/button");
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_HTTPHEADER => $H,
  CURLOPT_POSTFIELDS => $payload, CURLOPT_RETURNTRANSFER => true]);
$result = json_decode(curl_exec($ch), true);
```

## 6. Admin / operasional

- `GET /admin/stats` — user, session per status, pesan masuk/keluar/hari ini.
- `GET /admin/sessions` — semua session semua user + status live.
- `POST /admin/sessions/:id/stop`, `DELETE /admin/sessions/:id`, `GET /admin/messages?session=&limit=`.
- Backup: folder `sessions/` + dump MySQL berkala.
- Production: HTTPS via reverse proxy, `CORS_ORIGIN` = domain frontend,
  `JWT_SECRET` panjang & acak, rate-limit default cukup (ketatkan `RATE_PAIR_MAX` bila perlu).
