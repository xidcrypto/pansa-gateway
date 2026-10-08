# Baileys Gateway — REST API WhatsApp multi-user (Elaina fork, support button)

Backend WhatsApp untuk banyak user: tiap user login (JWT), punya session WA sendiri-sendiri
(UUID), role `admin` / `user`, data di MySQL, webhook per user, security hardening.

> **Dokumentasi: `API.md`** (panduan integrasi frontend) · **`GET /docs`** (Swagger UI coba
> langsung) · **`GET /openapi.json`** (import Postman).

## Syarat

- Node.js 20+
- MySQL 8 / MariaDB 10.6+ (XAMPP/Laragon/standalone — lihat "Setup MySQL" di bawah)

## Setup MySQL (sekali saja)

1. Pastikan MySQL jalan, lalu bikin database + user:
   ```sql
   CREATE DATABASE wa_gateway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   -- Opsional, user khusus (ganti passwordnya):
   -- CREATE USER 'wa'@'localhost' IDENTIFIED BY 'ganti-ini';
   -- GRANT ALL ON wa_gateway.* TO 'wa'@'localhost'; FLUSH PRIVILEGES;
   ```
2. Copy env dan isi:
   ```bash
   copy .env.example .env
   ```
   ```ini
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root        # atau wa
   DB_PASS=            # passwordnya
   DB_NAME=wa_gateway
   JWT_SECRET=isi-min-32-char-acak
   ```
3. Generate JWT secret cepat (PowerShell):
   ```powershell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))
   ```

## Jalanin

```bash
npm install
npm start              # atau: npm run dev (watch mode)
```

Start pertama: tabel (`users`, `sessions`, `messages`) dibuat otomatis + **admin pertama**
dibuat otomatis (username `admin`, password tampil sekali di console — segera ganti via
`PATCH /auth/password` atau panel admin).

## Konsep

| Hal | Aturan |
|---|---|
| Auth user | `POST /auth/login` → JWT (`Authorization: Bearer ...`) |
| Auth server-to-server | Header `x-api-key` (= `API_KEY`) → akses admin penuh, tanpa JWT |
| Session | `POST /sessions` → UUID. Owner = user yang login. User biasa **hanya lihat/makai miliknya** |
| Role | `admin`: semua session + kelola user + `/admin/*`. `user`: session + pesan miliknya |
| Webhook | Per user (`PATCH /auth/me`), fallback ke `WEBHOOK_URL` global |
| Riwayat | Semua pesan masuk/keluar tersimpan di MySQL (`/messages/*` baca dari DB) |

## Endpoint ringkas

| Area | Contoh |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `PATCH /auth/me`, `PATCH /auth/password` |
| User (admin) | `GET/POST /auth/users`, `PATCH/DELETE /auth/users/:id` |
| Session | `POST /sessions`, `GET /sessions/:id/qr`, `POST /sessions/:id/pair {phone,code?}`, `GET /sessions/:id/status` |
| Kirim | `/sessions/:s/send/text|image|video|audio|document|sticker|location|contact|poll|button|list|carousel|buttonv2` |
| Kelola pesan | `/react`, `/delete`, `/edit`, `/forward`, `/read`, `/messages/incoming`, `/messages/outgoing` |
| Grup | list/bikin/info/ubah/member/invite/join/setting/ephemeral/requests |
| Util | presence, cek nomor, avatar, blocklist, profil, download media |
| Admin | `GET /admin/stats`, `GET /admin/sessions`, `POST /admin/sessions/:id/stop`, `GET /admin/messages` |

Detail tiap endpoint + contoh request: **`API.md`** dan **`/docs`**.

## Contoh cepat

```bash
# login
TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"..."}' | jq -r .token)

# bikin session (owner = kamu)
curl -X POST localhost:3000/sessions -H "Authorization: Bearer $TOKEN"
# → {"id":"4c75e898-...","status":"connecting"}

# pairing code custom 8 char
curl -X POST localhost:3000/sessions/<uuid>/pair -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"phone":"62812...","code":"TOKOKU01"}'

# kirim teks
curl -X POST localhost:3000/sessions/<uuid>/send/text -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"to":"62812...","text":"halo"}'
```

## Keamanan bawaan

JWT + bcrypt, API key master (header saja, bukan query), helmet, CORS dikonfigurasi
(`CORS_ORIGIN`), rate-limit global + ketat untuk login & pairing, anti-SSRF untuk
`media.url` (IP/host internal ditolak), `media.path` di-sandbox ke `MEDIA_DIR`,
isolasi session per user, error 500 tidak bocorkan detail.

Production: pasang HTTPS via reverse proxy (nginx/Caddy), `CORS_ORIGIN` = domain
frontend, `JWT_SECRET` panjang, backup folder `sessions/` + database berkala.

## Catatan WA

- `single_select` (list) tampil penuh hanya di Android; di Web/iOS jadi teks.
- Ganti foto profil butuh `sharp` (`npm i sharp`) kalau belum ada.
