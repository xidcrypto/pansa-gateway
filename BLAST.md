# Blast — kirim massal ke ribuan nomor (1 campaign = 1 pesan ke N nomor)

Base: `http://localhost:3000`. Semua butuh `Authorization: Bearer <token>`
(campaign milik user yang login; admin boleh semua).

## Bikin campaign (langsung jalan)

```bash
POST /sessions/<uuid>/blast
{
  "label": "Promo Oktober",
  "text": "Halo {{nama}}, ada promo spesial buat {{nomor}}!",
  "media": { "url": "https://..." },          # opsional: gambar header
  "buttons": [                                 # opsional, maks 10
    { "kind": "reply", "text": "Mau!", "id": "mau_{{nomor}}" },
    { "kind": "url", "text": "Katalog", "url": "https://..." },
    { "kind": "copy", "text": "Salin kode", "code": "PROMO10" }
  ],
  "recipients": ["62812...", { "phone": "62813...", "nama": "Budi" }],
  "delayMin": 3000,                            # jeda antar kirim (ms), default 3-8 detik
  "delayMax": 8000
}
→ 201 { "campaignId": 1, "total": 1500, "sessionId": "<uuid>", "status": "running" }
```

- `text` wajib. `{{nama}}` / `{{nomor}}` / `{{var}}` diganti per penerima.
- `recipients`: array string nomor, array object `{ phone, nama?, vars? }`,
  atau **string** dipisah koma/baris baru (paste dari Excel). Duplikat & nomor invalid
  otomatis dibuang. Maks **50.000** nomor per campaign.
- Mode otomatis: text saja / text+gambar / text+button / text+gambar+button.
- `media`: `{ url }` | `{ base64 }` | `{ dataUri }` | `{ path }` (aturan aman sama kayak kirim biasa).

## Pantau & kendalikan

```bash
GET  /sessions/<uuid>/blast                        # list campaign session ini
GET  /sessions/<uuid>/blast/1                      # detail + statistik { pending, sent, failed }
GET  /sessions/<uuid>/blast/1/recipients?status=failed&limit=50
POST /sessions/<uuid>/blast/1/pause                # jeda (bisa resume)
POST /sessions/<uuid>/blast/1/resume               # lanjutkan yang pending
POST /sessions/<uuid>/blast/1/cancel               # berhenti permanen
```

## Anti-ban bawaan

- **Delay acak** antar kirim (default 3–8 detik, bisa diatur per campaign).
- **Auto-pause** kalau WA balas 429/rate-limit — lanjutkan manual via `resume`
  setelah cooldown (jangan langsung gas lagi).
- Campaign yang kepotong restart server **otomatis dilanjutkan**.
- Tiap kirim tercatat di `messages` (bisa diaudit via `GET /admin/messages`).

## Tips aman blast ribuan nomor

1. Nomor pengirim sudah **warm-up** (umur akun lama, ada aktivitas chat biasa dulu).
2. Mulai batch kecil (100–300/hari per nomor), naikkan bertahap.
3. Delay jangan terlalu kecil — untuk 5000 nomor dengan delay 5 dtk ≈ 7 jam.
   Butuh cepat = sebar ke beberapa session/nomor pengirim (1 campaign = 1 session).
4. Sediakan opt-out (`Balas STOP untuk berhenti`) biar tidak di-report spam.
5. Gunakan personalisasi `{{nama}}` — pesan identik massal lebih gampang ke-flag.

## Contoh JS: blast 2000 nomor dari CSV

```js
const csv = await fetch('https://.../kontak.csv').then(r => r.text());
const recipients = csv.split('\n').slice(1).map(line => {
  const [phone, nama] = line.split(',');
  return { phone: phone.trim(), nama: nama?.trim() };
});
await fetch(`${GW}/sessions/${id}/blast`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    label: 'Promo', text: 'Halo {{nama}}, promo khusus hari ini!',
    buttons: [{ kind: 'reply', text: 'Mau', id: 'mau' }],
    recipients, delayMin: 4000, delayMax: 9000,
  }),
});
```
