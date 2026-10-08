/** Shared route helpers: async wrapper + uniform JSON envelope */

export function asyncH(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

export function ok(res, data = {}, status = 200) {
  res.status(status).json({ success: true, ...data })
}

export function requireSock(req) {
  const sid = req.params.session || req.body?.session || req.query.session || 'default'
  return { sid }
}
