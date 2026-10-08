/**
 * OpenAPI 3.0 spec untuk Baileys Gateway.
 * Disajikan di /docs (Swagger UI) dan /openapi.json (raw spec).
 */
export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Baileys Gateway',
    version: '1.0.0',
    description:
      'REST API WhatsApp multi-user di atas @rexxhayanasi/elaina-baileys: auth JWT + role admin/user, session per user, kirim teks/media/button/list/carousel, grup, webhook per user.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: {
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token dari POST /auth/login',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Master key server-to-server (pengganti JWT, akses admin penuh)',
      },
    },
    parameters: {
      SessionId: {
        name: 'session',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'UUID session dari POST /sessions',
      },
      GroupJid: {
        name: 'jid',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'JID grup, cth: 62812...@g.us (URL-encode @ menjadi %40)',
      },
    },
    schemas: {
      Ok: { type: 'object', properties: { success: { type: 'boolean', example: true } } },
      Err: {
        type: 'object',
        properties: { success: { type: 'boolean', example: false }, error: { type: 'string' } },
      },
      To: { type: 'string', description: 'Nomor (628..), JID (@s.whatsapp.net), atau grup (@g.us)', example: '6281234567890' },
      Media: {
        type: 'object',
        description: 'Salah satu dari url/base64/dataUri/path',
        properties: {
          url: { type: 'string', example: 'https://example.com/foto.jpg' },
          base64: { type: 'string' },
          dataUri: { type: 'string' },
          path: { type: 'string', description: 'Path lokal di server' },
          mimetype: { type: 'string' },
          filename: { type: 'string' },
        },
      },
      Button: {
        type: 'object',
        required: ['text'],
        properties: {
          kind: {
            type: 'string',
            enum: ['reply', 'url', 'copy', 'call', 'reminder', 'cancelReminder', 'address', 'location', 'raw'],
            default: 'reply',
          },
          text: { type: 'string', example: 'Ping' },
          id: { type: 'string', description: 'reply/call/reminder/address: payload id', example: 'ping' },
          url: { type: 'string', description: 'kind=url' },
          code: { type: 'string', description: 'kind=copy: teks yang disalin' },
          options: { type: 'object', description: 'kind=location' },
          name: { type: 'string', description: 'kind=raw: native-flow name' },
          params: { type: 'object', description: 'kind=raw: native-flow params' },
        },
      },
      Session: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['connecting', 'qr', 'pairing', 'open', 'close', 'logged_out'] },
          me: { type: 'object', nullable: true },
          hasQr: { type: 'boolean' },
          hasPairingCode: { type: 'boolean' },
        },
      },
      SendResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          messageId: { type: 'string' },
          to: { type: 'string' },
          status: { type: 'string', example: 'sent' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: { summary: 'Cek server (+ status DB)', security: [], responses: { 200: { description: 'OK' } } },
    },
    '/auth/login': {
      post: {
        summary: 'Login → JWT',
        security: [],
        tags: ['Auth'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } } } } },
        responses: { 200: { description: '{ token, user }' }, 401: { description: 'Salah' } },
      },
    },
    '/auth/me': {
      get: {
        summary: 'Profil sendiri', tags: ['Auth'],
        responses: { 200: { description: '{ user }' } },
      },
      patch: {
        summary: 'Atur webhook sendiri', tags: ['Auth'],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { webhookUrl: { type: 'string' }, webhookSecret: { type: 'string' } } } } } },
        responses: { 200: { description: '{ user }' } },
      },
    },
    '/auth/password': {
      patch: {
        summary: 'Ganti password', tags: ['Auth'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['oldPassword', 'newPassword'], properties: { oldPassword: { type: 'string' }, newPassword: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/auth/users': {
      get: {
        summary: 'List user (admin)', tags: ['Auth'],
        responses: { 200: { description: 'Daftar user' } },
      },
      post: {
        summary: 'Bikin user (admin)', tags: ['Auth'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' }, role: { type: 'string', enum: ['admin', 'user'] } } } } } },
        responses: { 201: { description: 'User dibuat' } },
      },
    },
    '/auth/users/{id}': {
      patch: {
        summary: 'Ubah user (admin)', tags: ['Auth'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { password: { type: 'string' }, role: { type: 'string' }, active: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        summary: 'Hapus user (admin)', tags: ['Auth'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/admin/stats': {
      get: { summary: 'Statistik sistem (admin)', tags: ['Admin'], responses: { 200: { description: 'Stats' } } },
    },
    '/admin/sessions': {
      get: { summary: 'Semua session semua user (admin)', tags: ['Admin'], responses: { 200: { description: 'List' } } },
    },
    '/admin/sessions/{id}/stop': {
      post: {
        summary: 'Paksa stop session user (admin)', tags: ['Admin'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/admin/messages': {
      get: {
        summary: 'Intip pesan untuk audit (admin)', tags: ['Admin'],
        parameters: [{ name: 'session', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: { description: 'List' } },
      },
    },
    '/sessions': {
      get: {
        summary: 'List semua session',
        responses: { 200: { description: 'Daftar session', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, sessions: { type: 'array', items: { $ref: '#/components/schemas/Session' } } } } } } } },
      },
      post: {
        summary: 'Bikin session baru (ID = UUID dari backend)',
        responses: { 201: { description: 'Session dibuat', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, id: { type: 'string', format: 'uuid' }, status: { type: 'string' } } } } } } },
      },
    },
    '/sessions/{id}/start': {
      post: {
        summary: 'Start / reuse session',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Session jalan' } },
      },
    },
    '/sessions/{id}/qr': {
      get: {
        summary: 'Ambil QR (data URL) untuk scan',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '{ status, qr }' } },
      },
    },
    '/sessions/{id}/status': {
      get: {
        summary: 'Status + QR + pairing + info akun',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Info session' } },
      },
    },
    '/sessions/{id}/pair': {
      post: {
        summary: 'Minta pairing code (custom 8 char opsional)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: 'string' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phone'],
                properties: {
                  phone: { type: 'string', example: '6281234567890' },
                  code: { type: 'string', example: 'TOKOKU01', description: 'Custom 8 char A-Z/0-9. Kosong = random.' },
                },
              },
            },
          },
        },
        responses: { 200: { description: '{ pairingCode, custom }' }, 400: { description: 'Validasi gagal' } },
      },
    },
    '/sessions/{id}/pair/cancel': {
      post: {
        summary: 'Batalkan pairing code yang pending',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: '{ cancelled }' } },
      },
    },
    '/sessions/{id}/stop': {
      post: {
        summary: 'Stop session (logout=true juga keluar dari HP)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { logout: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'Stopped' } },
      },
    },
    '/sessions/{session}/send/text': {
      post: {
        summary: 'Kirim teks',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['to', 'text'], properties: { to: { $ref: '#/components/schemas/To' }, text: { type: 'string' }, replyTo: { type: 'string', description: 'messageId yang dibalas' } } } } },
        },
        responses: { 200: { description: 'Terkirim', content: { 'application/json': { schema: { $ref: '#/components/schemas/SendResult' } } } } },
      },
    },
    '/sessions/{session}/send/image': {
      post: {
        summary: 'Kirim gambar',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' }, caption: { type: 'string' }, media: { $ref: '#/components/schemas/Media' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/video': {
      post: {
        summary: 'Kirim video (gifPlayback=true jadi GIF)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' }, caption: { type: 'string' }, media: { $ref: '#/components/schemas/Media' }, gifPlayback: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/audio': {
      post: {
        summary: 'Kirim audio / voice note (ptt=true)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' }, media: { $ref: '#/components/schemas/Media' }, ptt: { type: 'boolean' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/document': {
      post: {
        summary: 'Kirim dokumen',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' }, filename: { type: 'string' }, media: { $ref: '#/components/schemas/Media' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/sticker': {
      post: {
        summary: 'Kirim stiker',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' }, media: { $ref: '#/components/schemas/Media' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/location': {
      post: {
        summary: 'Kirim lokasi',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'latitude', 'longitude'], properties: { to: { $ref: '#/components/schemas/To' }, latitude: { type: 'number' }, longitude: { type: 'number' }, name: { type: 'string' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/contact': {
      post: {
        summary: 'Kirim kontak (vCard)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'name', 'phone'], properties: { to: { $ref: '#/components/schemas/To' }, name: { type: 'string' }, phone: { type: 'string' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/poll': {
      post: {
        summary: 'Kirim polling',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'question', 'options'], properties: { to: { $ref: '#/components/schemas/To' }, question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/button': {
      post: {
        summary: 'Kirim interactive button (reply/url/copy/call/...)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to', 'body', 'buttons'],
                properties: {
                  to: { $ref: '#/components/schemas/To' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  footer: { type: 'string' },
                  image: { type: 'string', description: 'URL gambar header' },
                  video: { type: 'string', description: 'URL video header' },
                  buttons: { type: 'array', items: { $ref: '#/components/schemas/Button' } },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/list': {
      post: {
        summary: 'Kirim list menu (single-select, tampil penuh di Android)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to', 'body', 'sections'],
                properties: {
                  to: { $ref: '#/components/schemas/To' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  footer: { type: 'string' },
                  buttonText: { type: 'string' },
                  sections: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        rows: { type: 'array', items: { type: 'object', properties: { header: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, id: { type: 'string' } } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/carousel': {
      post: {
        summary: 'Kirim carousel (tiap kartu wajib image/video)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to', 'cards'],
                properties: {
                  to: { $ref: '#/components/schemas/To' },
                  body: { type: 'string' },
                  footer: { type: 'string' },
                  cards: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        body: { type: 'string' },
                        image: { type: 'string' },
                        video: { type: 'string' },
                        buttons: { type: 'array', items: { $ref: '#/components/schemas/Button' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/send/buttonv2': {
      post: {
        summary: 'Kirim classic quick-reply buttons',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'body', 'buttons'], properties: { to: { $ref: '#/components/schemas/To' }, body: { type: 'string' }, footer: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' }, buttons: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, id: { type: 'string' } } } } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/react': {
      post: {
        summary: 'Kirim reaction emoji',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'messageId'], properties: { to: { $ref: '#/components/schemas/To' }, messageId: { type: 'string' }, emoji: { type: 'string', example: '👍' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/delete': {
      post: {
        summary: 'Hapus pesan (untuk semua orang)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'messageId'], properties: { to: { $ref: '#/components/schemas/To' }, messageId: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/edit': {
      post: {
        summary: 'Edit pesan teks',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'messageId', 'text'], properties: { to: { $ref: '#/components/schemas/To' }, messageId: { type: 'string' }, text: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/forward': {
      post: {
        summary: 'Teruskan pesan (content = isi pesan asli dari webhook)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'messageId', 'content'], properties: { to: { $ref: '#/components/schemas/To' }, messageId: { type: 'string' }, content: { type: 'object' } } } } } },
        responses: { 200: { description: 'Terkirim' } },
      },
    },
    '/sessions/{session}/read': {
      post: {
        summary: 'Tandai pesan dibaca',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'messageIds'], properties: { to: { $ref: '#/components/schemas/To' }, messageIds: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/messages/incoming': {
      get: {
        summary: 'Pesan masuk terakhir (buffer in-memory)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { 200: { description: 'List pesan' } },
      },
    },
    '/sessions/{session}/messages/outgoing': {
      get: {
        summary: 'Pesan terkirim terakhir',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }],
        responses: { 200: { description: 'List pesan' } },
      },
    },
    '/sessions/{session}/groups': {
      get: {
        summary: 'List grup yang diikuti',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        responses: { 200: { description: 'List grup' } },
      },
      post: {
        summary: 'Bikin grup baru',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['subject'], properties: { subject: { type: 'string' }, participants: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 201: { description: 'Grup dibuat' } },
      },
    },
    '/sessions/{session}/groups/{jid}': {
      get: {
        summary: 'Info grup / metadata',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        responses: { 200: { description: 'Metadata grup' } },
      },
      patch: {
        summary: 'Ubah subject / description grup',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { subject: { type: 'string' }, description: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/groups/{jid}/leave': {
      post: {
        summary: 'Keluar dari grup',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/groups/{jid}/participants': {
      post: {
        summary: 'Kelola member (add/remove/promote/demote)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action', 'participants'], properties: { action: { type: 'string', enum: ['add', 'remove', 'promote', 'demote'] }, participants: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/groups/{jid}/invite': {
      get: {
        summary: 'Ambil link invite grup',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        responses: { 200: { description: '{ code, link }' } },
      },
    },
    '/sessions/{session}/groups/{jid}/invite/revoke': {
      post: {
        summary: 'Reset link invite grup',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        responses: { 200: { description: '{ code, link }' } },
      },
    },
    '/sessions/{session}/groups/join': {
      post: {
        summary: 'Join grup via code/link',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, link: { type: 'string' } } } } } },
        responses: { 200: { description: 'Joined' } },
      },
    },
    '/sessions/{session}/groups/invite-info/{code}': {
      get: {
        summary: 'Info link invite tanpa join',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Info invite' } },
      },
    },
    '/sessions/{session}/groups/{jid}/settings': {
      post: {
        summary: 'Setting grup (announce/restrict/not_announce/not_restrict)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['setting'], properties: { setting: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/groups/{jid}/ephemeral': {
      post: {
        summary: 'Pesan sementara (0/86400/604800/7776000)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { duration: { type: 'integer' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/groups/{jid}/requests': {
      post: {
        summary: 'List/approve/reject request join',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { $ref: '#/components/parameters/GroupJid' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'approve', 'reject'] }, participants: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/presence': {
      post: {
        summary: 'Set presence (available/unavailable/composing/recording/paused)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['type'], properties: { to: { $ref: '#/components/schemas/To' }, type: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/subscribe': {
      post: {
        summary: 'Subscribe presence kontak',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to'], properties: { to: { $ref: '#/components/schemas/To' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/check': {
      post: {
        summary: 'Cek nomor terdaftar WhatsApp',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { phone: { type: 'string' }, phones: { type: 'array', items: { type: 'string' } } } } } } },
        responses: { 200: { description: 'Hasil cek' } },
      },
    },
    '/sessions/{session}/avatar/{phone}': {
      get: {
        summary: 'URL foto profil',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { name: 'phone', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: '{ url }' } },
      },
    },
    '/sessions/{session}/status/{phone}': {
      get: {
        summary: 'About/status kontak',
        parameters: [{ $ref: '#/components/parameters/SessionId' }, { name: 'phone', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Status' } },
      },
    },
    '/sessions/{session}/blocklist': {
      get: {
        summary: 'List kontak diblokir',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        responses: { 200: { description: 'Blocklist' } },
      },
    },
    '/sessions/{session}/block': {
      post: {
        summary: 'Block / unblock kontak',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phone', 'action'], properties: { phone: { type: 'string' }, action: { type: 'string', enum: ['block', 'unblock'] } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/profile': {
      patch: {
        summary: 'Ubah nama / bio profil',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, status: { type: 'string' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/profile/picture': {
      post: {
        summary: 'Ganti foto profil (butuh sharp)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { media: { $ref: '#/components/schemas/Media' } } } } } },
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        summary: 'Hapus foto profil',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/sessions/{session}/download': {
      post: {
        summary: 'Download media dari pesan (base64)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['message'], properties: { message: { type: 'object', description: 'Objek pesan mentah dari webhook' }, asDataUri: { type: 'boolean' } } } } } },
        responses: { 200: { description: '{ base64, bytes }' } },
      },
    },
    '/sessions/{session}/pair-code': {
      post: {
        summary: 'Alias pairing code (sama dgn /sessions/:id/pair)',
        parameters: [{ $ref: '#/components/parameters/SessionId' }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['phone'], properties: { phone: { type: 'string' }, code: { type: 'string' } } } } } },
        responses: { 200: { description: '{ pairingCode, custom }' } },
      },
    },
  },
  tags: [
    { name: 'Auth', description: 'Login & kelola user' },
    { name: 'Sessions', description: 'Bikin & kelola koneksi' },
    { name: 'Send', description: 'Kirim pesan' },
    { name: 'Groups', description: 'Kelola grup' },
    { name: 'Misc', description: 'Presence, kontak, profil, util' },
    { name: 'Admin', description: 'Monitoring & audit (role admin)' },
  ],
}
