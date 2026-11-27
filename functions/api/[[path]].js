import { createClient } from '@libsql/client/web';
import { 
  conciliarReporteZ, 
  conciliarTodosReportesZ, 
  conciliarVentaIndividual, 
  getResumenCruceDobleVia,
  getProximaFacturaZ,
  getCruceComprasEntradas,
  getCruceVentasSalidas,
  getSalidasTiendaAgrupadas,
  verificarDuplicadoLibroCompras,
  verificarDuplicadoEntradaAlmacen
} from '../lib/cruce_engine.js';
import { 
  getMatrizAuditoriaProductos, 
  procesarMatrizAuditada,
  getListadoAuditoriaEnVivo,
  actualizarProductoAuditoria,
  crearProductoAuditoria,
  toggleAuditadoProducto
} from '../lib/auditoria_punto_cero.js';
import {
  CATALOGO_CONCEPTOS_ISLR,
  SERVICIO_A_CONCEPTOS,
  normalizarTipoContribuyente,
  resolverConceptoISLR,
  syncCatalogoConceptosISLR,
  obtenerDatosXmlISLR,
  adecuarCodigosRetencionesPeriodo
} from '../lib/islr_seniat.js';
import {
  computeLibroInventarioArt177,
  getMesAMesCompat,
  mapItemsArt177ExportRows
} from '../lib/libro_art177.js';

const TURSO_URL = 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

const AUTH_SALT = 'DG67_UCG_SALT_2026';
const MANUAL_ACCESS_KEYS = ['DG67-MANUAL', 'SUMA-DG67', 'DG67-2026'];
const workerLoginAttempts = new Map();

function getDb(env) {
  return createClient({
    url: env?.TURSO_DATABASE_URL || TURSO_URL,
    authToken: env?.TURSO_AUTH_TOKEN || TURSO_AUTH_TOKEN
  });
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password + AUTH_SALT);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function signAuthToken(payloadObj) {
  const payloadB64 = toBase64Url(JSON.stringify(payloadObj));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AUTH_SALT + '_HMAC_V1'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payloadB64}.${sigHex}`;
}

async function verifyAuthToken(tokenStr) {
  if (!tokenStr || typeof tokenStr !== 'string' || !tokenStr.includes('.')) return null;
  const parts = tokenStr.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigHex] = parts;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(AUTH_SALT + '_HMAC_V1'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const expectedHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (sigHex !== expectedHex) return null;
    const payload = JSON.parse(fromBase64Url(payloadB64));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      map[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return map;
}

async function extractSessionUser(request) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    const verified = await verifyAuthToken(bearer);
    if (verified) return verified;
  }
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  if (cookies.suma_session) {
    const verified = await verifyAuthToken(cookies.suma_session);
    if (verified) return verified;
  }
  const fallbackRole = String(request.headers.get('X-Suma-Role') || '').trim().toUpperCase();
  if (fallbackRole) {
    return { rol: fallbackRole, legacy: true };
  }
  return null;
}

function isOperadorBlockedRoute(path, method) {
  if (path.startsWith('/api/fiscal/') && path !== '/api/fiscal/cruce-compras-entradas') return true;
  if (path.startsWith('/api/cruce/')) return true;
  if (path.startsWith('/api/islr/')) return true;
  if (path === '/api/tasas-bcv/diaria' || path === '/api/tasas-bcv/revalorizar-cierre') return true;
  if (path === '/api/reportes/libro-inventario-seniat' || path === '/api/reportes/mes-a-mes') return true;
  if (path.startsWith('/api/export/libro-')) return true;
  if (
    path === '/api/auditoria/toma-fisica/cerrar' ||
    path === '/api/auditoria/toma-fisica/reabrir' ||
    path === '/api/auditoria/toma-fisica/apertura' ||
    path === '/api/auditoria/acta-oficial'
  ) return true;
  if ((path === '/api/proveedores' || path.startsWith('/api/proveedores/')) && method !== 'GET') return true;
  return false;
}

function parseAlicuotaDecimal(val, defaultVal = 0.16) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return defaultVal;
  return num > 1 ? Number((num / 100).toFixed(4)) : num;
}

function isRifValidoFormato(rif) {
  return /^[VEJGPC]-?\d{7,9}-?\d?$/i.test(String(rif || '').trim());
}

function normalizeFactNum(val) {
  const m = String(val || '').match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function traducirErrorNegocio(err) {
  const msg = String(err?.message || err || 'Error desconocido');
  if (/UNIQUE constraint failed/i.test(msg)) {
    return 'Ya existe un registro con ese número de documento, código o comprobante.';
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return 'Uno de los valores numéricos ingresados no es válido (verifique cantidades y montos mayores a 0).';
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return 'Alguno de los registros referenciados no existe o fue eliminado.';
  }
  return msg;
}

async function recalculateDeclaracionIva(periodo, db) {
  if (!periodo) return;
  try {
    const [vRes, cRes, prevRes] = await Promise.all([
      db.execute({
        sql: `SELECT COALESCE(SUM(base_imponible_bs), 0) as v_base, COALESCE(SUM(iva_bs), 0) as v_deb, COUNT(DISTINCT fecha) as v_dias FROM libro_ventas WHERE periodo = ?`,
        args: [periodo]
      }),
      db.execute({
        sql: `SELECT COALESCE(SUM(base_imponible_bs), 0) as c_base, COALESCE(SUM(iva_bs), 0) as c_cred, COUNT(*) as c_facs FROM libro_compras WHERE periodo = ?`,
        args: [periodo]
      }),
      db.execute({
        sql: `SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1`,
        args: [periodo]
      })
    ]);

    const vBase = Number(vRes.rows[0]?.v_base || 0);
    const vDeb = Number(vRes.rows[0]?.v_deb || 0);
    const vDias = Number(vRes.rows[0]?.v_dias || 0);
    const cBase = Number(cRes.rows[0]?.c_base || 0);
    const cCred = Number(cRes.rows[0]?.c_cred || 0);
    const cFacs = Number(cRes.rows[0]?.c_facs || 0);
    const excAnt = Number(prevRes.rows[0]?.excedente_siguiente_bs || 0);
    const totCred = Number((cCred + excAnt).toFixed(2));
    const saldo = Number((vDeb - totCred).toFixed(2));
    const aPagar = saldo > 0 ? saldo : 0;
    const excSig = saldo < 0 ? Math.abs(saldo) : 0;

    await db.execute({
      sql: `
        INSERT INTO declaraciones_iva (
          periodo, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
          iva_retenido_bs, excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs,
          total_compras_facturas, total_ventas_dias, estatus
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(periodo) DO UPDATE SET
          ventas_base_bs = excluded.ventas_base_bs,
          debito_fiscal_bs = excluded.debito_fiscal_bs,
          compras_base_bs = excluded.compras_base_bs,
          credito_fiscal_bs = excluded.credito_fiscal_bs,
          excedente_anterior_bs = excluded.excedente_anterior_bs,
          excedente_siguiente_bs = excluded.excedente_siguiente_bs,
          total_a_pagar_bs = excluded.total_a_pagar_bs,
          total_compras_facturas = excluded.total_compras_facturas,
          total_ventas_dias = excluded.total_ventas_dias
        WHERE declaraciones_iva.estatus != 'DECLARADO'
      `,
      args: [periodo, vBase, vDeb, cBase, cCred, excAnt, excSig, aPagar, cFacs, vDias, periodo <= '2026-09' ? 'DECLARADO' : 'EN_PROCESO']
    });
  } catch (e) {
    console.warn('No se pudo recalcular Forma 30:', e.message);
  }
}

async function isPeriodoDeclarado(periodo, db) {
  if (!periodo) return false;
  try {
    const res = await db.execute({
      sql: "SELECT estatus FROM declaraciones_iva WHERE periodo = ? LIMIT 1",
      args: [periodo]
    });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0].estatus === 'DECLARADO';
    }
  } catch (e) {
    console.error('Error verificando estatus de período declarado:', e);
  }
  return periodo <= '2026-09';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Suma-Role',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...extraHeaders
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 1. CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Suma-Role',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const db = getDb(env);
  const isHttps = url.protocol === 'https:';

  try {
    // ----------------------------------------------------
    // AUTHENTICATION, MANUAL KEY & HEALTH
    // ----------------------------------------------------
    if (path === '/api/health' && method === 'GET') {
      const [nowRes, empRes] = await Promise.all([
        db.execute("SELECT datetime('now') as now"),
        db.execute("SELECT * FROM empresas WHERE id = 1")
      ]);
      const emp = empRes.rows[0] || {};
      return jsonResponse({
        status: 'online',
        tursoConnected: true,
        serverTime: nowRes.rows[0]?.now || new Date().toISOString(),
        empresa: emp.razon_social || 'INVERSIONES DG 67, C.A.',
        rif: emp.rif || 'J-50700865-7',
        domicilio: emp.domicilio_fiscal,
        gerencia: emp.gerencia_regional,
        condicion_iva: emp.condicion_iva,
        comprobante: emp.nro_comprobante
      });
    }

    if (path === '/api/empresa' && method === 'GET') {
      const empRes = await db.execute("SELECT * FROM empresas WHERE id = 1");
      return jsonResponse(empRes.rows[0] || {});
    }

    if (path === '/api/auth/verify' && method === 'GET') {
      const authUser = await extractSessionUser(request);
      return jsonResponse({
        ok: true,
        active: Boolean(authUser),
        authenticated: Boolean(authUser && !authUser.legacy),
        usuario: authUser || null
      });
    }

    if (path === '/api/manual/verify' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const claveRaw = String(body?.clave || '').trim();
      if (!claveRaw) {
        return jsonResponse({ ok: false, error: 'Ingrese la clave de acceso del manual.' }, 400);
      }
      const claveUpper = claveRaw.toUpperCase();
      const envKey = String(env?.MANUAL_ACCESS_KEY || '').trim().toUpperCase();
      const allowedKeys = envKey ? [...MANUAL_ACCESS_KEYS, envKey] : MANUAL_ACCESS_KEYS;
      if (allowedKeys.includes(claveUpper)) {
        return jsonResponse({ ok: true, mensaje: 'Acceso autorizado al Manual Operativo de Gestión de Inventarios.' });
      }
      const hashedClave = await hashPassword(claveRaw);
      const userKeyRes = await db.execute({
        sql: 'SELECT id, rol FROM usuarios WHERE password_hash = ? AND activo = 1 LIMIT 1',
        args: [hashedClave]
      }).catch(() => ({ rows: [] }));
      if (userKeyRes.rows.length > 0) {
        return jsonResponse({ ok: true, mensaje: 'Acceso autorizado al Manual Operativo de Gestión de Inventarios.' });
      }
      return jsonResponse({ ok: false, error: 'Clave incorrecta. Solicite la clave vigente a Administración o use su contraseña de usuario.' }, 401);
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
      const nowMs = Date.now();
      const rec = workerLoginAttempts.get(clientIp);
      if (rec && rec.lockUntil && nowMs < rec.lockUntil) {
        const mins = Math.ceil((rec.lockUntil - nowMs) / 60000);
        return jsonResponse({ error: `Demasiados intentos fallidos. Intente de nuevo en ${mins} minuto(s).` }, 429);
      }

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: 'Payload JSON inválido' }, 400);
      }
      const { usuario, password } = body || {};
      if (!usuario || !password) {
        return jsonResponse({ error: 'Por favor ingrese su usuario y contraseña.' }, 400);
      }

      const hashed = await hashPassword(password);
      const result = await db.execute({
        sql: 'SELECT id, usuario, nombre_completo, email, rol, activo FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND password_hash = ?',
        args: [usuario.trim(), hashed]
      });

      if (result.rows.length === 0) {
        const prev = workerLoginAttempts.get(clientIp) || { count: 0 };
        prev.count += 1;
        if (prev.count >= 5) prev.lockUntil = nowMs + 15 * 60 * 1000;
        workerLoginAttempts.set(clientIp, prev);
        return jsonResponse({ error: 'Usuario o contraseña incorrectos. Verifique sus credenciales.' }, 401);
      }

      const user = result.rows[0];
      if (!user.activo) {
        return jsonResponse({ error: 'Cuenta de usuario inactiva. Comuníquese con Unión Contable Global.' }, 403);
      }

      workerLoginAttempts.delete(clientIp);

      await db.execute({
        sql: "UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?",
        args: [user.id]
      });

      const token = await signAuthToken({
        id: user.id,
        usuario: user.usuario,
        rol: String(user.rol || '').toUpperCase(),
        exp: Date.now() + 24 * 60 * 60 * 1000
      });

      const cookieStr = `suma_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${isHttps ? '; Secure' : ''}`;

      return jsonResponse({
        ok: true,
        mensaje: 'Acceso autorizado al Sistema SUMA • Inventario & Fiscal',
        token,
        usuario: {
          id: user.id,
          usuario: user.usuario,
          nombre: user.nombre_completo,
          email: user.email,
          rol: user.rol
        }
      }, 200, { 'Set-Cookie': cookieStr });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const clearCookie = `suma_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${isHttps ? '; Secure' : ''}`;
      return jsonResponse({
        ok: true,
        mensaje: 'Sesión finalizada y destruida con éxito.'
      }, 200, { 'Set-Cookie': clearCookie });
    }

    // Control de acceso por Rol (RBAC) para proteger módulos fiscales frente a perfil OPERADOR
    const authUser = await extractSessionUser(request);
    const activeRole = String(authUser?.rol || '').toUpperCase();
    if ((activeRole === 'OPERADOR' || activeRole === 'VENDEDOR') && isOperadorBlockedRoute(path, method)) {
      return jsonResponse({
        error: 'Acceso restringido: su perfil Operador tiene acceso exclusivo al módulo de Gestión de Inventarios y Toma Física.'
      }, 403);
    }

    // ----------------------------------------------------
    // DASHBOARD & KPIs
    // ----------------------------------------------------
    if (path === '/api/dashboard' && method === 'GET') {
      const [
        counts,
        stockSummary,
        lowStockCount,
        tasaCfgRes,
        monthlyFlowRes,
        topSalesRes,
        criticalProductsRes,
        categoryStats,
        recentMovs
      ] = await Promise.all([
        db.execute("SELECT COUNT(*) as total_productos FROM productos WHERE activo = 1"),
        db.execute(`
          SELECT 
            COALESCE(SUM(stock_actual), 0) as stock_total_unidades,
            COALESCE(SUM(CASE WHEN stock_actual > 0 THEN valor_total_usd ELSE 0 END), 0) as valor_total_usd,
            COUNT(CASE WHEN stock_actual > stock_minimo THEN 1 END) as stock_optimo_count,
            COUNT(CASE WHEN stock_actual <= stock_minimo AND stock_actual > 0 THEN 1 END) as stock_alerta_count,
            COUNT(CASE WHEN stock_actual <= 0 THEN 1 END) as stock_agotado_count
          FROM vista_inventario_actual
        `),
        db.execute("SELECT COUNT(*) as alert_count FROM vista_inventario_actual WHERE estado_stock = 'SOLICITAR MATERIAL'"),
        db.execute("SELECT metodo_valoracion_kardex, tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1"),
        db.execute(`
          SELECT 
            t.periodo,
            t.fecha_cierre,
            t.tasa_bcv,
            COALESCE(lc.facs_mercancia, comp.cant_compras, 0) as cant_compras,
            COALESCE(comp.unidades_compradas, 0) as unidades_compradas,
            ROUND(COALESCE(lc.base_mercancia_usd, comp.monto_compras_usd, 0), 2) as compras_usd,
            ROUND(COALESCE(lc.base_mercancia_bs, comp.monto_compras_bs, 0), 2) as compras_bs,
            COALESCE(vent.cant_ventas, 0) as cant_ventas,
            COALESCE(vent.unidades_vendidas, 0) as unidades_vendidas,
            ROUND(COALESCE(vent.monto_ventas_usd, 0), 2) as ventas_usd,
            ROUND(COALESCE(vent.monto_ventas_bs, 0), 2) as ventas_bs
          FROM tasas_bcv_periodo t
          LEFT JOIN (
            SELECT 
              periodo,
              count(*) as facs_mercancia,
              sum(base_imponible_bs) as base_mercancia_bs,
              sum(base_imponible_divisa) as base_mercancia_usd
            FROM libro_compras
            WHERE aplica_inventario = 1
            GROUP BY periodo
          ) lc ON t.periodo = lc.periodo
          LEFT JOIN (
            SELECT 
              substr(m.fecha, 1, 7) as mes,
              count(distinct m.id) as cant_compras,
              sum(md.cantidad) as unidades_compradas,
              ROUND(SUM(COALESCE(NULLIF(md.total_linea_divisa, 0), md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), 2.5))), 2) as monto_compras_usd,
              ROUND(SUM(COALESCE(NULLIF(md.total_linea_bs, 0), NULLIF(md.total_linea_divisa, 0) * m.tasa_bcv, md.cantidad * COALESCE(NULLIF(md.costo_unitario_bs, 0), md.costo_unitario_usd * m.tasa_bcv, 2.5 * m.tasa_bcv))), 2) as monto_compras_bs
            FROM movimientos m
            JOIN movimiento_detalles md ON m.id = md.movimiento_id
            WHERE m.tipo IN ('ENTRADA_COMPRA', 'INVENTARIO_INICIAL')
            GROUP BY substr(m.fecha, 1, 7)
          ) comp ON t.periodo = comp.mes
          LEFT JOIN (
            SELECT 
              substr(m.fecha, 1, 7) as mes,
              count(distinct m.id) as cant_ventas,
              sum(md.cantidad) as unidades_vendidas,
              ROUND(SUM(COALESCE(NULLIF(md.total_linea_divisa, 0), md.cantidad * COALESCE(NULLIF(md.precio_unitario_divisa, 0), NULLIF(md.costo_unitario_usd, 0), 2.5))), 2) as monto_ventas_usd,
              ROUND(SUM(COALESCE(NULLIF(md.total_linea_bs, 0), NULLIF(md.total_linea_divisa, 0) * m.tasa_bcv, md.cantidad * COALESCE(NULLIF(md.precio_unitario_divisa, 0), NULLIF(md.costo_unitario_usd, 0), 2.5) * m.tasa_bcv)), 2) as monto_ventas_bs
            FROM movimientos m
            JOIN movimiento_detalles md ON m.id = md.movimiento_id
            WHERE m.tipo = 'SALIDA_VENTA' AND COALESCE(m.subtipo, 'VENTA') = 'VENTA'
            GROUP BY substr(m.fecha, 1, 7)
          ) vent ON t.periodo = vent.mes
          ORDER BY t.periodo ASC
        `),
        db.execute(`
          SELECT 
            p.id, p.codigo, p.descripcion, COALESCE(c.nombre, 'GENERAL') as categoria,
            p.stock_minimo,
            v.stock_actual,
            COALESCE(SUM(md.cantidad), 0) as unidades_vendidas,
            ROUND(COALESCE(SUM(COALESCE(NULLIF(md.total_linea_divisa, 0), md.cantidad * NULLIF(p.costo_referencial_usd, 0), md.cantidad * 2.5)), 0), 2) as total_ventas_usd,
            ROUND(COALESCE(SUM(COALESCE(NULLIF(md.total_linea_bs, 0), NULLIF(md.total_linea_divisa, 0) * 889.58, md.cantidad * COALESCE(NULLIF(p.costo_referencial_usd, 0), 2.5) * 889.58)), 0), 2) as total_ventas_bs
          FROM productos p
          JOIN vista_inventario_actual v ON p.id = v.producto_id
          LEFT JOIN categorias c ON p.categoria_id = c.id
          JOIN movimiento_detalles md ON p.id = md.producto_id
          JOIN movimientos m ON md.movimiento_id = m.id
          WHERE m.tipo = 'SALIDA_VENTA' AND COALESCE(m.subtipo, 'VENTA') = 'VENTA'
          GROUP BY p.id
          ORDER BY unidades_vendidas DESC
          LIMIT 10
        `),
        db.execute(`
          SELECT 
            p.id, p.codigo, p.descripcion, COALESCE(c.nombre, 'GENERAL') as categoria,
            p.stock_minimo, v.stock_actual,
            ROUND(p.stock_minimo - v.stock_actual, 1) as deficit,
            p.costo_referencial_usd
          FROM vista_inventario_actual v
          JOIN productos p ON v.producto_id = p.id
          LEFT JOIN categorias c ON p.categoria_id = c.id
          WHERE v.stock_actual <= p.stock_minimo
          ORDER BY deficit DESC
          LIMIT 8
        `),
        db.execute(`
          SELECT 
            categoria, 
            COUNT(*) as productos_count,
            ROUND(SUM(stock_actual), 1) as unidades_stock,
            ROUND(SUM(valor_total_usd), 2) as valor_usd
          FROM vista_inventario_actual
          GROUP BY categoria
          ORDER BY unidades_stock DESC
          LIMIT 8
        `),
        db.execute(`
          SELECT 
            m.id, m.tipo, m.fecha, m.numero_documento, m.observaciones,
            COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as proveedor_nombre,
            COUNT(md.id) as total_items,
            COALESCE(SUM(md.cantidad), 0) as total_unidades
          FROM movimientos m
          LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
          LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
          GROUP BY m.id
          ORDER BY m.fecha DESC, m.id DESC
          LIMIT 8
        `)
      ]);

      const cfg = tasaCfgRes.rows[0] || {};
      const tasaBcvActiva = Number(cfg.tasa_bcv_activa_dia || 889.26);
      const fechaBcvActiva = cfg.fecha_bcv_activa_dia || '2026-11-01';
      const valTotalUsd = Number(stockSummary.rows[0]?.valor_total_usd || 0);
      const valTotalBs = Number((valTotalUsd * tasaBcvActiva).toFixed(2));
      const totProductos = Number(counts.rows[0]?.total_productos || 0);
      const stockOptimo = Number(stockSummary.rows[0]?.stock_optimo_count || 0);
      const stockAgotado = Number(stockSummary.rows[0]?.stock_agotado_count || 0);
      const nivelServicio = totProductos > 0 ? Number(((stockOptimo / totProductos) * 100).toFixed(1)) : 100;

      let totComprasUsd = 0, totComprasBs = 0, totVentasUsd = 0, totVentasBs = 0;
      let totUnidadesCompradas = 0, totUnidadesVendidas = 0;
      for (const m of monthlyFlowRes.rows) {
        totComprasUsd += Number(m.compras_usd || 0);
        totComprasBs += Number(m.compras_bs || 0);
        totVentasUsd += Number(m.ventas_usd || 0);
        totVentasBs += Number(m.ventas_bs || 0);
        totUnidadesCompradas += Number(m.unidades_compradas || 0);
        totUnidadesVendidas += Number(m.unidades_vendidas || 0);
      }

      const stockUnidades = Number(stockSummary.rows[0]?.stock_total_unidades || 0);
      const rotacionInventario = stockUnidades > 0 ? Number((totUnidadesVendidas / stockUnidades).toFixed(2)) : 0;
      const diasInventario = totUnidadesVendidas > 0 ? Math.round((stockUnidades / (totUnidadesVendidas / 300))) : 365;

      return jsonResponse({
        totalProductos: totProductos,
        stockTotalUnidades: stockUnidades,
        valorTotalUsd: valTotalUsd,
        valorTotalBs: valTotalBs,
        tasaBcvActiva,
        fechaBcvActiva,
        productosEnAlerta: lowStockCount.rows[0]?.alert_count || 0,
        productosAgotados: stockAgotado,
        nivelServicio,
        stockOptimo,
        rotacionInventario,
        diasInventario,
        totalesAnio: {
          totComprasUsd: Math.round(totComprasUsd * 100) / 100,
          totComprasBs: Math.round(totComprasBs * 100) / 100,
          totVentasUsd: Math.round(totVentasUsd * 100) / 100,
          totVentasBs: Math.round(totVentasBs * 100) / 100,
          totUnidadesCompradas,
          totUnidadesVendidas
        },
        flujoMensual: monthlyFlowRes.rows,
        topProductosVendidos: topSalesRes.rows,
        productosCriticos: criticalProductsRes.rows,
        topCategorias: categoryStats.rows,
        recientes: recentMovs.rows
      });
    }

    // ----------------------------------------------------
    // CATALOGS: CATEGORIAS, ALMACENES, PROVEEDORES
    // ----------------------------------------------------
    if (path === '/api/categorias' && method === 'GET') {
      const res = await db.execute("SELECT id, nombre FROM categorias ORDER BY nombre ASC");
      return jsonResponse(res.rows);
    }

    if (path === '/api/almacenes' && method === 'GET') {
      const res = await db.execute("SELECT id, codigo, nombre FROM almacenes ORDER BY nombre ASC");
      return jsonResponse(res.rows);
    }

    if (path === '/api/proveedores' && method === 'GET') {
      const res = await db.execute(`
        SELECT 
          p.id, p.rif, p.razon_social,
          COALESCE(p.tipo_servicio, 'MERCANCIA_REPUESTOS') as tipo_servicio,
          COALESCE(p.aplica_inventario, 1) as aplica_inventario,
          COALESCE(p.porcentaje_retencion, 0.0) as porcentaje_retencion,
          COALESCE(p.tipo_persona, CASE WHEN p.rif LIKE 'V%' OR p.rif LIKE 'E%' THEN 'PN-R' ELSE 'PJ-D' END) as tipo_persona,
          COALESCE(p.direccion_fiscal, '') as direccion_fiscal,
          COALESCE(p.codigo_concepto_islr, '055') as codigo_concepto_islr,
          p.telefono, p.email,
          COUNT(lc.id) as total_facturas_asociadas
        FROM proveedores p
        LEFT JOIN libro_compras lc ON p.id = lc.proveedor_id
        GROUP BY p.id
        ORDER BY p.razon_social ASC
      `);
      const normalizedRows = (res.rows || []).map(p => {
        const resIslr = resolverConceptoISLR({
          tipoServicio: p.tipo_servicio,
          rif: p.rif,
          tipoPersona: p.tipo_persona,
          codigoActual: p.codigo_concepto_islr
        });
        return {
          ...p,
          tipo_persona: resIslr.tipo_contribuyente,
          codigo_concepto_islr: (p.codigo_concepto_islr && p.codigo_concepto_islr !== '055') || resIslr.tipo_contribuyente === 'PJ-D'
            ? (p.codigo_concepto_islr || resIslr.codigo_sugerido)
            : resIslr.codigo_sugerido,
          codigo_sugerido_seniat: resIslr.codigo_sugerido,
          tarifa_sugerida_seniat: resIslr.concepto_sugerido.pct_tarifa
        };
      });
      return jsonResponse(normalizedRows);
    }

    if (path === '/api/proveedores' && method === 'POST') {
      const b = await request.json();
      const cleanRif = String(b.rif || '').trim().toUpperCase();
      const cleanRazon = String(b.razon_social || '').trim();
      if (!cleanRif || !cleanRazon) return jsonResponse({ error: 'RIF y Razón Social son requeridos' }, 400);

      const tipoSrv = b.tipo_servicio || 'MERCANCIA_REPUESTOS';
      const tipoPers = normalizarTipoContribuyente(cleanRif, b.tipo_persona);
      const resIslr = resolverConceptoISLR({ tipoServicio: tipoSrv, rif: cleanRif, tipoPersona: tipoPers });
      const codIslr = b.codigo_concepto_islr || resIslr.codigo_sugerido;

      const ins = await db.execute({
        sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [
          cleanRif, cleanRazon, tipoSrv,
          b.aplica_inventario ? 1 : 0, Number(b.porcentaje_retencion) || 0.0,
          b.telefono || null, b.email || null,
          tipoPers,
          b.direccion_fiscal || '', codIslr
        ]
      });
      return jsonResponse({ success: true, id: ins.rows[0]?.id, message: 'Proveedor creado', codigo_concepto_islr: codIslr, tipo_persona: tipoPers });
    }

    if (path.startsWith('/api/proveedores/') && path.endsWith('/clasificacion') && method === 'PATCH') {
      const id = path.replace('/api/proveedores/', '').replace('/clasificacion', '');
      const b = await request.json();
      const { tipo_servicio, aplica_inventario, codigo_concepto_islr } = b;
      const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;

      const provActualRes = await db.execute({ sql: "SELECT rif, tipo_persona FROM proveedores WHERE id = ?", args: [id] }).catch(() => ({ rows: [] }));
      const provActual = provActualRes.rows[0] || {};
      const resIslr = resolverConceptoISLR({ tipoServicio: tipo_servicio, rif: provActual.rif, tipoPersona: provActual.tipo_persona });
      const codIslr = codigo_concepto_islr || resIslr.codigo_sugerido;

      await db.execute({
        sql: `UPDATE proveedores SET tipo_servicio = ?, aplica_inventario = ?, tipo_persona = ?, codigo_concepto_islr = ? WHERE id = ?`,
        args: [tipo_servicio, aplicaInvInt, resIslr.tipo_contribuyente, codIslr, id]
      });

      const nuevoEstatus = aplicaInvInt === 0 ? 'NO_APLICA_GASTO' : 'NO_CONCILIADO';
      await db.execute({
        sql: `
          UPDATE libro_compras 
          SET tipo_servicio = ?, 
              aplica_inventario = ?,
              estatus_conciliacion = CASE WHEN estatus_conciliacion = 'CONCILIADO' THEN 'CONCILIADO' ELSE ? END,
              observaciones_cruce = CASE 
                WHEN ? = 0 THEN 'Clasificado como Gasto/Servicio - No afecta inventario físico'
                ELSE 'Clasificado como Proveedor de Mercancía - Requiere cuadre con entrada'
              END
          WHERE proveedor_id = ?
            AND NOT EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_compras.periodo AND d.estatus = 'DECLARADO')
            AND (libro_compras.periodo > '2026-09' OR EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_compras.periodo AND d.estatus = 'EN_PROCESO'))
        `,
        args: [tipo_servicio, aplicaInvInt, nuevoEstatus, aplicaInvInt, id]
      });

      return jsonResponse({
        success: true,
        message: `Proveedor clasificado como ${aplicaInvInt ? 'Mercancía / Inventario' : 'Gasto / Servicio'} (Cód. ISLR ${codIslr}).`
      });
    }

    if (path.startsWith('/api/proveedores/') && !path.endsWith('/clasificacion') && method === 'PUT') {
      const id = path.replace('/api/proveedores/', '');
      const b = await request.json();
      const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr } = b;
      const cleanRif = rif ? String(rif).trim().toUpperCase() : null;
      if (cleanRif && !isRifValidoFormato(cleanRif)) {
        return jsonResponse({ error: 'Formato de RIF inválido. Ejemplo válido: J-12345678-9 o V-12345678-0.' }, 400);
      }
      const cleanRazon = razon_social ? String(razon_social).trim() : null;
      const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
      const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
      const retencionNum = Number(porcentaje_retencion) || 0.0;

      const resolvedTipoPers = normalizarTipoContribuyente(cleanRif, tipo_persona);
      const resIslr = resolverConceptoISLR({ tipoServicio: cleanTipo, rif: cleanRif, tipoPersona: resolvedTipoPers });
      const resolvedCodIslr = codigo_concepto_islr || resIslr.codigo_sugerido;

      await db.execute({
        sql: `UPDATE proveedores 
              SET rif = COALESCE(?, rif),
                  razon_social = COALESCE(?, razon_social),
                  tipo_servicio = ?,
                  aplica_inventario = ?,
                  porcentaje_retencion = ?,
                  telefono = ?,
                  email = ?,
                  tipo_persona = ?,
                  direccion_fiscal = COALESCE(?, direccion_fiscal),
                  codigo_concepto_islr = ?
              WHERE id = ?`,
        args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt, retencionNum, telefono || null, email || null, resolvedTipoPers, direccion_fiscal !== undefined ? direccion_fiscal : null, resolvedCodIslr, id]
      });

      const nuevoEstatus = aplicaInvInt === 0 ? 'NO_APLICA_GASTO' : 'NO_CONCILIADO';
      await db.execute({
        sql: `
          UPDATE libro_compras 
          SET tipo_servicio = ?, 
              aplica_inventario = ?,
              estatus_conciliacion = CASE WHEN estatus_conciliacion = 'CONCILIADO' THEN 'CONCILIADO' ELSE ? END,
              observaciones_cruce = CASE 
                WHEN ? = 0 THEN 'Clasificado como Gasto/Servicio - No afecta inventario físico'
                ELSE 'Clasificado como Proveedor de Mercancía - Requiere cuadre con entrada'
              END
          WHERE proveedor_id = ?
            AND NOT EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_compras.periodo AND d.estatus = 'DECLARADO')
            AND (libro_compras.periodo > '2026-09' OR EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_compras.periodo AND d.estatus = 'EN_PROCESO'))
        `,
        args: [cleanTipo, aplicaInvInt, nuevoEstatus, aplicaInvInt, id]
      });

      return jsonResponse({ success: true, message: 'Proveedor actualizado exitosamente.' });
    }

    if (path.startsWith('/api/proveedores/') && method === 'DELETE') {
      const id = parseInt(path.replace('/api/proveedores/', ''), 10);
      if (!id) return jsonResponse({ error: 'ID de proveedor inválido' }, 400);

      const [lcCount, movCount] = await Promise.all([
        db.execute({ sql: "SELECT COUNT(*) as count FROM libro_compras WHERE proveedor_id = ?", args: [id] }),
        db.execute({ sql: "SELECT COUNT(*) as count FROM movimientos WHERE proveedor_id = ?", args: [id] })
      ]);

      const facturas = Number(lcCount.rows[0]?.count || 0);
      const movs = Number(movCount.rows[0]?.count || 0);

      if (facturas > 0 || movs > 0) {
        return jsonResponse({
          error: `No se puede eliminar este proveedor porque tiene ${facturas} factura(s) en Libro de Compras y ${movs} movimiento(s) de inventario asociados para resguardo de la trazabilidad contable.`
        }, 400);
      }

      await db.execute({ sql: "DELETE FROM proveedores WHERE id = ?", args: [id] });
      return jsonResponse({ success: true, message: 'Proveedor eliminado exitosamente.' });
    }

    // ----------------------------------------------------
    // PRODUCTOS & KARDEX
    // ----------------------------------------------------
    if (path === '/api/productos' && method === 'GET') {
      const q = url.searchParams.get('q');
      const cat = url.searchParams.get('categoria');
      const alm = url.searchParams.get('almacen');
      const est = url.searchParams.get('estado');
      const fechaCorte = url.searchParams.get('fecha_corte');
      const incluirInactivos = url.searchParams.get('incluir_inactivos') === '1';
      const limit = parseInt(url.searchParams.get('limit') || '1000', 10);

      let sql;
      const args = [];
      let tasa = 889.26;
      let fechaTasa = '31/10/2026';

      if (fechaCorte) {
        const targetPeriodo = String(fechaCorte).slice(0, 7);
        const [tasaRes, cfgRes] = await Promise.all([
          db.execute({
            sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?",
            args: [targetPeriodo]
          }),
          db.execute("SELECT tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1")
        ]);

        if (tasaRes.rows.length > 0 && tasaRes.rows[0].tasa_bcv) {
          tasa = Number(tasaRes.rows[0].tasa_bcv);
          fechaTasa = tasaRes.rows[0].fecha_cierre || fechaCorte;
        } else {
          tasa = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.26);
          fechaTasa = cfgRes.rows[0]?.fecha_bcv_activa_dia || fechaCorte;
        }

        sql = `
          SELECT 
            p.id AS producto_id,
            p.codigo,
            p.descripcion,
            p.unidad_medida,
            COALESCE(c.nombre, 'GENERAL') AS categoria,
            COALESCE(a.nombre, 'PRINCIPAL') AS almacen,
            p.stock_minimo,
            p.costo_referencial_usd,
            p.precio_venta_usd,
            ROUND(COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0), 2) AS stock_actual,
            ROUND(COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0) * p.costo_referencial_usd, 2) AS valor_total_usd,
            CASE 
              WHEN COALESCE(SUM(CASE 
                WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                     OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                     THEN md.cantidad 
                WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                     OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                     THEN -md.cantidad 
                ELSE 0 
              END), 0) <= p.stock_minimo THEN 'SOLICITAR MATERIAL'
              ELSE 'HAY SUFICIENTE'
            END AS estado_stock
          FROM productos p
          LEFT JOIN categorias c ON p.categoria_id = c.id
          LEFT JOIN almacenes a ON p.almacen_id = a.id
          LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
          LEFT JOIN movimientos m ON md.movimiento_id = m.id AND m.fecha <= ?
          WHERE 1=1
        `;
        args.push(fechaCorte);
        if (!incluirInactivos) {
          sql += ` AND COALESCE(p.inactivo, 0) = 0 AND COALESCE(p.activo, 1) = 1`;
        }

        if (q) {
          sql += ` AND (p.codigo LIKE ? OR p.descripcion LIKE ?)`;
          args.push(`%${q}%`, `%${q}%`);
        }
        if (cat && cat !== 'TODAS') {
          sql += ` AND COALESCE(c.nombre, 'GENERAL') = ?`;
          args.push(cat);
        }
        if (alm && alm !== 'TODOS') {
          sql += ` AND COALESCE(a.nombre, 'PRINCIPAL') = ?`;
          args.push(alm);
        }

        sql += ` GROUP BY p.id`;
        if (est && est !== 'TODOS') {
          sql += ` HAVING estado_stock = ?`;
          args.push(est);
        }

        sql += ` ORDER BY p.codigo ASC LIMIT ?`;
        args.push(limit);

      } else {
        const cfgRes = await db.execute("SELECT tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1");
        tasa = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.26);
        fechaTasa = cfgRes.rows[0]?.fecha_bcv_activa_dia || 'Al día';

        sql = `
          SELECT v.producto_id, v.codigo, v.descripcion, v.unidad_medida, 
                 v.categoria, v.almacen, v.stock_minimo, v.costo_referencial_usd, 
                 COALESCE(p.precio_venta_usd, 0) AS precio_venta_usd,
                 v.stock_actual, v.valor_total_usd, v.estado_stock
          FROM vista_inventario_actual v
          LEFT JOIN productos p ON p.id = v.producto_id
          WHERE 1=1
        `;
        if (!incluirInactivos) {
          sql += ` AND COALESCE(p.inactivo, 0) = 0 AND COALESCE(p.activo, 1) = 1`;
        }

        if (q) {
          sql += ` AND (v.codigo LIKE ? OR v.descripcion LIKE ?)`;
          args.push(`%${q}%`, `%${q}%`);
        }
        if (cat && cat !== 'TODAS') {
          sql += ` AND v.categoria = ?`;
          args.push(cat);
        }
        if (alm && alm !== 'TODOS') {
          sql += ` AND v.almacen = ?`;
          args.push(alm);
        }
        if (est && est !== 'TODOS') {
          sql += ` AND v.estado_stock = ?`;
          args.push(est);
        }

        sql += ` ORDER BY v.codigo ASC LIMIT ?`;
        args.push(limit);
      }

      const res = await db.execute({ sql, args });

      const enriched = res.rows.map(r => {
        const cUsd = Number(r.costo_referencial_usd || 0);
        const vUsd = Number(r.valor_total_usd || 0);
        return {
          ...r,
          tasa_bcv_aplicada: tasa,
          fecha_tasa_bcv: fechaTasa,
          costo_unitario_bs: Number((cUsd * tasa).toFixed(2)),
          valor_total_bs: Number((vUsd * tasa).toFixed(2))
        };
      });

      return jsonResponse(enriched);
    }

    if (path.startsWith('/api/kardex/') && method === 'GET') {
      const codigo = decodeURIComponent(path.replace('/api/kardex/', ''));
      const metodoQuery = String(url.searchParams.get('metodo') || '').toUpperCase();

      const [prodRes, cfgRes, tasasRes] = await Promise.all([
        db.execute({
          sql: `SELECT * FROM vista_inventario_actual WHERE UPPER(codigo) = UPPER(?)`,
          args: [codigo]
        }),
        db.execute("SELECT metodo_valoracion_kardex, tasa_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1"),
        db.execute("SELECT periodo, tasa_bcv FROM tasas_bcv_periodo")
      ]);

      if (prodRes.rows.length === 0) {
        return jsonResponse({ error: 'Producto no encontrado' }, 404);
      }

      const tasasKardexMap = {};
      for (const tr of (tasasRes.rows || [])) {
        tasasKardexMap[tr.periodo] = Number(tr.tasa_bcv || 0);
      }
      const tasaIni2025 = tasasKardexMap['2025-12'] || 298.1431;
      const tasaActivaDia = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.26);

      const metodoActivo = (metodoQuery === 'PEPS' || metodoQuery === 'FIFO')
        ? 'PEPS'
        : (metodoQuery === 'CPP' ? 'CPP' : (cfgRes.rows[0]?.metodo_valoracion_kardex || 'CPP'));

      const prod = prodRes.rows[0];
      const refUsd = Number(prod.costo_referencial_usd || 0);

      const movsRes = await db.execute({
        sql: `
          SELECT 
            m.id as movimiento_id,
            m.fecha,
            m.tipo,
            COALESCE(m.subtipo, CASE WHEN m.tipo='SALIDA_VENTA' THEN 'VENTA' WHEN m.tipo='ENTRADA_COMPRA' THEN 'COMPRA_NACIONAL' ELSE m.tipo END) as subtipo,
            m.numero_documento,
            COALESCE(m.nro_control, '-') as nro_control,
            COALESCE(m.usuario_responsable, 'ADMIN_SISTEMA') as usuario_responsable,
            COALESCE(NULLIF(md.tasa_bcv_operacion, 0), NULLIF(m.tasa_bcv, 0), ?) as tasa_bcv,
            COALESCE(m.fecha_tasa_bcv, m.fecha) as fecha_tasa_bcv,
            COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as tercero,
            COALESCE(pr.rif, '-') as tercero_rif,
            md.cantidad,
            COALESCE(NULLIF(md.costo_unitario_divisa, 0), md.costo_unitario_usd) as costo_unitario_usd,
            COALESCE(NULLIF(md.costo_unitario_bs, 0), md.costo_unitario_ves) as costo_unitario_ves,
            CASE WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                      OR (m.tipo='AJUSTE' AND (UPPER(COALESCE(m.subtipo,'')) LIKE '%POSITIVO%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%ENTRADA%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%SOBRANTE%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%OMISION%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%RECLASIF%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%SINCERACION%'))
                 THEN md.cantidad ELSE 0 END as entrada,
            CASE WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                      OR (m.tipo='AJUSTE' AND NOT (UPPER(COALESCE(m.subtipo,'')) LIKE '%POSITIVO%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%ENTRADA%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%SOBRANTE%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%OMISION%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%RECLASIF%' OR UPPER(COALESCE(m.subtipo,'')) LIKE '%SINCERACION%'))
                 THEN md.cantidad ELSE 0 END as salida
          FROM movimiento_detalles md
          JOIN movimientos m ON md.movimiento_id = m.id
          LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
          WHERE md.producto_id = ?
          ORDER BY m.fecha ASC, m.id ASC
        `,
        args: [tasaActivaDia, prod.producto_id]
      });

      let balance = 0;
      let cppUsd = refUsd;
      let cppVes = Number((refUsd * tasaIni2025).toFixed(2));
      let valTotalUsd = 0;
      let valTotalVes = 0;
      const fifoQueue = [];

      const history = movsRes.rows.map(row => {
        const ent = Number(row.entrada || 0);
        const sal = Number(row.salida || 0);
        const rowPer = String(row.fecha || '').slice(0, 7);
        const tasa = Number(row.tasa_bcv || tasasKardexMap[rowPer] || tasaActivaDia);
        const unitUsd = Number(row.costo_unitario_usd || 0) > 0 ? Number(row.costo_unitario_usd) : (cppUsd > 0 ? cppUsd : refUsd);
        const unitVes = Number(row.costo_unitario_ves || 0) > 0 ? Number(row.costo_unitario_ves) : Number((unitUsd * tasa).toFixed(2));

        let movCostoUnitVes = cppVes;
        let movCostoTotalVes = 0;
        let movCostoUnitUsd = cppUsd;
        let movCostoTotalUsd = 0;

        if (ent > 0) {
          movCostoUnitUsd = unitUsd;
          movCostoTotalUsd = ent * unitUsd;
          movCostoUnitVes = unitVes;
          movCostoTotalVes = ent * unitVes;

          fifoQueue.push({ qty: ent, unitUsd, unitVes });

          const newStock = balance + ent;
          if (metodoActivo === 'PEPS') {
            balance = newStock;
            valTotalUsd = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitUsd, 0);
            valTotalVes = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitVes, 0);
            cppUsd = balance > 0 ? valTotalUsd / balance : unitUsd;
            cppVes = balance > 0 ? valTotalVes / balance : unitVes;
          } else {
            if (newStock > 0) {
              cppUsd = (valTotalUsd + movCostoTotalUsd) / newStock;
              cppVes = (valTotalVes + movCostoTotalVes) / newStock;
            }
            balance = newStock;
            valTotalUsd = balance * cppUsd;
            valTotalVes = balance * cppVes;
          }
        } else if (sal > 0) {
          if (metodoActivo === 'PEPS') {
            let rem = sal;
            let costUsdAcc = 0;
            let costVesAcc = 0;
            while (rem > 0 && fifoQueue.length > 0) {
              const lot = fifoQueue[0];
              const take = Math.min(rem, lot.qty);
              costUsdAcc += take * lot.unitUsd;
              costVesAcc += take * lot.unitVes;
              lot.qty -= take;
              rem -= take;
              if (lot.qty <= 0.0001) fifoQueue.shift();
            }
            if (rem > 0) {
              costUsdAcc += rem * cppUsd;
              costVesAcc += rem * cppVes;
            }
            movCostoTotalUsd = costUsdAcc;
            movCostoTotalVes = costVesAcc;
            movCostoUnitUsd = sal > 0 ? costUsdAcc / sal : cppUsd;
            movCostoUnitVes = sal > 0 ? costVesAcc / sal : cppVes;
            balance = balance - sal;
            valTotalUsd = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitUsd, 0);
            valTotalVes = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitVes, 0);
            if (balance > 0) {
              cppUsd = valTotalUsd / balance;
              cppVes = valTotalVes / balance;
            }
          } else {
            movCostoUnitUsd = cppUsd;
            movCostoTotalUsd = sal * cppUsd;
            movCostoUnitVes = cppVes;
            movCostoTotalVes = sal * cppVes;

            balance = balance - sal;
            valTotalUsd = balance * cppUsd;
            valTotalVes = balance * cppVes;
          }
        }

        return {
          ...row,
          metodo_valoracion: metodoActivo,
          costo_unitario_divisa: Number(unitUsd.toFixed(2)),
          tasa_bcv_operacion: Number(tasa.toFixed(2)),
          costo_unitario_bs: Number(unitVes.toFixed(2)),
          costo_operacion_usd: Number(movCostoUnitUsd.toFixed(2)),
          monto_operacion_usd: Number(movCostoTotalUsd.toFixed(2)),
          costo_operacion_ves: Number(movCostoUnitVes.toFixed(2)),
          monto_operacion_ves: Number(movCostoTotalVes.toFixed(2)),
          cpp_resultante_usd: Number(cppUsd.toFixed(2)),
          cpp_resultante_ves: Number(cppVes.toFixed(2)),
          saldo: Number(balance.toFixed(2)),
          valor_saldo_usd: Number(valTotalUsd.toFixed(2)),
          valor_saldo_ves: Number(valTotalVes.toFixed(2))
        };
      });

      return jsonResponse({
        metodo_valoracion: metodoActivo,
        producto: {
          ...prod,
          metodo_valoracion: metodoActivo,
          cpp_actual_usd: Number(cppUsd.toFixed(2)),
          cpp_actual_ves: Number(cppVes.toFixed(2)),
          valor_total_usd_kardex: Number(valTotalUsd.toFixed(2)),
          valor_total_ves: Number(valTotalVes.toFixed(2))
        },
        historial: history
      });
    }

    if (path === '/api/inventario/toma-fisica' && method === 'POST') {
      const body = await request.json();
      const { producto_id, conteo_fisico, observacion_auditoria, generar_ajuste_automatico, usuario_responsable } = body || {};
      if (!producto_id || conteo_fisico === undefined || conteo_fisico === null || isNaN(Number(conteo_fisico))) {
        return jsonResponse({ error: 'Debe indicar el artículo y una cantidad física válida.' }, 400);
      }

      const actaClosedRes = await db.execute("SELECT periodo FROM actas_toma_fisica WHERE estatus = 'CERRADA' ORDER BY updated_at DESC LIMIT 1").catch(() => ({ rows: [] }));
      const actaOpenRes = await db.execute("SELECT periodo FROM actas_toma_fisica WHERE estatus = 'ABIERTA' LIMIT 1").catch(() => ({ rows: [] }));
      if (actaOpenRes.rows.length === 0 && actaClosedRes.rows.length > 0) {
        return jsonResponse({ error: 'El acta de Toma Física está cerrada. Reabra el acta antes de modificar conteos.' }, 403);
      }

      const fechaHoy = new Date().toLocaleDateString('en-CA');
      await db.execute({
        sql: `UPDATE productos SET conteo_fisico_cierre = ?, stock_auditado_fisico = ?, fecha_conteo_fisico = ?, observacion_auditoria = ?, auditado = 1 WHERE id = ?`,
        args: [Number(conteo_fisico), Number(conteo_fisico), fechaHoy, observacion_auditoria || 'Verificado en Toma Física de Cierre', Number(producto_id)]
      });

      if (generar_ajuste_automatico) {
        const [stRes, cfgRes] = await Promise.all([
          db.execute({ sql: `SELECT stock_actual, costo_referencial_usd FROM vista_inventario_actual WHERE producto_id = ?`, args: [Number(producto_id)] }),
          db.execute("SELECT tasa_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1")
        ]);
        if (stRes.rows.length > 0) {
          const teo = Number(stRes.rows[0].stock_actual || 0);
          const fis = Number(conteo_fisico);
          const diff = Number((fis - teo).toFixed(2));
          if (diff !== 0) {
            const tasaOp = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.58);
            const esPositivo = diff > 0;
            const subtipo = esPositivo ? 'AJUSTE_POSITIVO_SOBRANTE' : 'MERMA_DANO';
            const movHeader = await db.execute({
              sql: `INSERT INTO movimientos (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, observaciones, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion)
                    VALUES ('AJUSTE', ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'CPP') RETURNING id`,
              args: [
                subtipo, fechaHoy,
                `ACTA-CIERRE-${producto_id}-${Date.now().toString().slice(-4)}`,
                `CTRL-AUD-${producto_id}`,
                usuario_responsable || 'ADMIN_DG67',
                observacion_auditoria || `Ajuste por Toma Física (Teórico: ${teo}, Físico: ${fis})`,
                tasaOp, fechaHoy
              ]
            });
            const movId = Number(movHeader.rows[0]?.id || movHeader.lastInsertRowid);
            const costoUsd = Number(stRes.rows[0].costo_referencial_usd || 0);
            const costoBs = Number((costoUsd * tasaOp).toFixed(2));
            await db.execute({
              sql: `INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves, costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [movId, Number(producto_id), Math.abs(diff), costoUsd, costoBs, costoUsd, tasaOp, costoBs]
            });
          }
        }
      }

      return jsonResponse({ success: true, message: 'Conteo físico registrado exitosamente.' });
    }

    // ----------------------------------------------------
    // SUB-MÓDULO DE TOMA FÍSICA Y AJUSTE DE INVENTARIO (PUNTO CERO)
    // ----------------------------------------------------
    if (path === '/api/auditoria/matriz' && method === 'GET') {
      const matriz = await getMatrizAuditoriaProductos(db);
      return jsonResponse(matriz);
    }

    if (path === '/api/auditoria/procesar-matriz' && method === 'POST') {
      const body = await request.json();
      const { items, opciones } = body;
      if (!items || !Array.isArray(items)) {
        return jsonResponse({ error: 'Se requiere un arreglo de productos auditados (items)' }, 400);
      }
      const resultado = await procesarMatrizAuditada(items, opciones || {}, db);
      return jsonResponse(resultado);
    }

    if (path === '/api/auditoria/listado-en-vivo' && method === 'GET') {
      const listado = await getListadoAuditoriaEnVivo(db);
      return jsonResponse(listado);
    }

    if (path.startsWith('/api/auditoria/actualizar-producto/') && method === 'POST') {
      const id = path.split('/api/auditoria/actualizar-producto/')[1];
      const body = await request.json();
      const resultado = await actualizarProductoAuditoria(id, body, db);
      return jsonResponse(resultado);
    }

    if (path === '/api/auditoria/crear-producto' && method === 'POST') {
      const body = await request.json();
      const resultado = await crearProductoAuditoria(body, db);
      return jsonResponse(resultado);
    }

    if (path.startsWith('/api/auditoria/toggle-auditado/') && method === 'POST') {
      const id = path.split('/api/auditoria/toggle-auditado/')[1];
      const body = await request.json();
      const resultado = await toggleAuditadoProducto(id, body?.auditado, db);
      return jsonResponse(resultado);
    }

    // ACTA OFICIAL DE CONSTATACIÓN FÍSICA Y AJUSTE DE INVENTARIO (Art. 177 RISLR / Art. 27 LISLR / PA 00093)
    if (path === '/api/auditoria/acta-oficial' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';

      const [empRes, tasasRes, prodRes, movsRes] = await Promise.all([
        db.execute("SELECT * FROM empresas WHERE id = 1"),
        db.execute({
          sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ? LIMIT 1",
          args: [periodo]
        }),
        db.execute(`
          SELECT 
            p.id, p.codigo, p.descripcion, 
            COALESCE(p.unidad_medida, 'UND') as unidad_medida,
            COALESCE(a.nombre, 'PRINCIPAL') as almacen,
            COALESCE(v.stock_actual, 0) as stock_teorico,
            COALESCE(p.conteo_fisico_cierre, p.stock_auditado_fisico, v.stock_actual, 0) as stock_fisico,
            COALESCE(p.costo_referencial_usd, 0) as costo_usd,
            COALESCE(p.precio_venta_usd, 0) as precio_usd,
            p.auditado,
            p.observacion_auditoria,
            p.fecha_auditoria
          FROM productos p
          LEFT JOIN vista_inventario_actual v ON p.id = v.producto_id
          LEFT JOIN almacenes a ON p.almacen_id = a.id
          WHERE p.auditado = 1 OR p.conteo_fisico_cierre IS NOT NULL
          ORDER BY p.codigo ASC
        `),
        db.execute({
          sql: `
            SELECT 
              m.id as movimiento_id,
              m.tipo,
              m.subtipo,
              m.fecha,
              m.numero_documento,
              m.observaciones,
              m.tasa_bcv,
              d.producto_id,
              p.codigo,
              p.descripcion,
              p.unidad_medida,
              d.cantidad,
              d.costo_unitario_usd,
              d.costo_unitario_ves,
              d.total_linea_bs,
              d.total_linea_divisa
            FROM movimientos m
            JOIN movimiento_detalles d ON m.id = d.movimiento_id
            JOIN productos p ON d.producto_id = p.id
            WHERE (m.tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE') OR m.tipo = 'AJUSTE')
              AND strftime('%Y-%m', m.fecha) = ?
            ORDER BY m.fecha ASC, p.codigo ASC
          `,
          args: [periodo]
        })
      ]);

      const empresa = empRes.rows[0] || {
        razon_social: 'INVERSIONES DG 67, C.A.',
        rif: 'J-50700865-7',
        direccion_fiscal: 'Av. Sur 11 entre Bolívar y Miranda, Casa 112, San Agustín del Norte, Caracas',
        gerencia_regional: 'Gerencia Regional Libertador - SENIAT'
      };

      const tasaBcv = Number(tasasRes.rows[0]?.tasa_bcv || 889.58);
      const fechaCierre = tasasRes.rows[0]?.fecha_cierre || `${periodo}-31`;

      const itemsAjustados = [];
      let totalBajasQty = 0;
      let totalBajasBs = 0;
      let totalBajasUsd = 0;
      let totalAltasQty = 0;
      let totalAltasBs = 0;
      let totalAltasUsd = 0;

      if (movsRes.rows && movsRes.rows.length > 0) {
        for (const m of movsRes.rows) {
          const isBaja = m.tipo === 'SALIDA_AJUSTE' || 
            (m.tipo === 'AJUSTE' && (
              String(m.subtipo || '').includes('NEGATIVO') || 
              String(m.subtipo || '').includes('SALIDA') || 
              String(m.subtipo || '').includes('FALTANTE') || 
              String(m.subtipo || '').includes('MERMA') || 
              String(m.subtipo || '').includes('DANO') ||
              String(m.subtipo || '').includes('OBSOLESCENCIA') ||
              String(m.subtipo || '').includes('AUTOCONSUMO')
            ));
          const qty = Number(m.cantidad || 0);
          const cUsd = Number(m.costo_unitario_usd || 0);
          const cBs = Number(m.costo_unitario_ves || (cUsd * tasaBcv));
          const totBs = Number(m.total_linea_bs || (qty * cBs));
          const totUsd = Number(m.total_linea_divisa || (qty * cUsd));

          if (isBaja) {
            totalBajasQty += qty;
            totalBajasBs += totBs;
            totalBajasUsd += totUsd;
          } else {
            totalAltasQty += qty;
            totalAltasBs += totBs;
            totalAltasUsd += totUsd;
          }

          itemsAjustados.push({
            id: m.movimiento_id,
            producto_id: m.producto_id,
            tipo_movimiento: m.tipo,
            codigo: m.codigo,
            descripcion: m.descripcion,
            unidad_medida: m.unidad_medida || 'UND',
            diferencia: isBaja ? -qty : qty,
            causa_legal: m.subtipo || (isBaja ? 'MERMA_DANO' : 'SOBRANTE_AUDITORIA'),
            observaciones: m.observaciones || '',
            fecha: m.fecha,
            costo_unitario_usd: cUsd,
            costo_unitario_bs: cBs,
            total_bs: totBs,
            total_usd: totUsd
          });
        }
      } else {
        for (const p of prodRes.rows) {
          const teorico = Number(p.stock_teorico || 0);
          const fisico = Number(p.stock_fisico || 0);
          const diff = Number((fisico - teorico).toFixed(2));
          if (diff !== 0) {
            const isBaja = diff < 0;
            const diffAbs = Math.abs(diff);
            const cUsd = Number(p.costo_usd || 0);
            const cBs = Number((cUsd * tasaBcv).toFixed(2));
            const totBs = Number((diffAbs * cBs).toFixed(2));
            const totUsd = Number((diffAbs * cUsd).toFixed(2));

            if (isBaja) {
              totalBajasQty += diffAbs;
              totalBajasBs += totBs;
              totalBajasUsd += totUsd;
            } else {
              totalAltasQty += diffAbs;
              totalAltasBs += totBs;
              totalAltasUsd += totUsd;
            }

            itemsAjustados.push({
              producto_id: p.id,
              codigo: p.codigo,
              descripcion: p.descripcion,
              unidad_medida: p.unidad_medida,
              stock_teorico: teorico,
              stock_fisico: fisico,
              diferencia: diff,
              causa_legal: isBaja ? 'EXTRAVIO_FALTANTE' : 'SOBRANTE_AUDITORIA',
              observaciones: p.observacion_auditoria || '',
              fecha: p.fecha_auditoria || fechaCierre,
              costo_unitario_usd: cUsd,
              costo_unitario_bs: cBs,
              total_bs: totBs,
              total_usd: totUsd
            });
          }
        }
      }

      return jsonResponse({
        success: true,
        acta_numero: `ACTA-INV-${periodo.replace('-', '')}-01`,
        periodo,
        fecha_acta: fechaCierre,
        tasa_bcv: tasaBcv,
        empresa,
        resumen: {
          total_productos_auditados: prodRes.rows.length,
          total_items_ajustados: itemsAjustados.length,
          total_bajas_unidades: Number(totalBajasQty.toFixed(2)),
          total_bajas_bs: Number(totalBajasBs.toFixed(2)),
          total_bajas_usd: Number(totalBajasUsd.toFixed(2)),
          total_altas_unidades: Number(totalAltasQty.toFixed(2)),
          total_altas_bs: Number(totalAltasBs.toFixed(2)),
          total_altas_usd: Number(totalAltasUsd.toFixed(2)),
          impacto_neto_bs: Number((totalAltasBs - totalBajasBs).toFixed(2)),
          impacto_neto_usd: Number((totalAltasUsd - totalBajasUsd).toFixed(2))
        },
        items: itemsAjustados
      });
    }

    // ----------------------------------------------------
    // ESTATUS, CIERRE Y REAPERTURA DE TOMA FÍSICA
    // ----------------------------------------------------
    if (path === '/api/auditoria/toma-fisica/estatus' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      await db.execute(`
        CREATE TABLE IF NOT EXISTS actas_toma_fisica (
          periodo TEXT PRIMARY KEY,
          numero_acta TEXT,
          estatus TEXT DEFAULT 'ABIERTA',
          fecha_corte TEXT,
          fecha_cierre TEXT,
          usuario_cierre TEXT,
          auditor_tienda TEXT,
          gerente_dg67 TEXT,
          contador_ucg TEXT,
          tasa_bcv REAL DEFAULT 889.58,
          resumen_items TEXT,
          updated_at TEXT
        );
      `).catch(() => {});
      await db.execute("ALTER TABLE actas_toma_fisica ADD COLUMN tasa_bcv REAL DEFAULT 889.58;").catch(() => {});

      const [actaRes, cfgRes] = await Promise.all([
        db.execute({ sql: "SELECT * FROM actas_toma_fisica WHERE periodo = ? LIMIT 1", args: [periodo] }),
        db.execute("SELECT tasa_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1")
      ]);
      const tasaVigente = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.58);

      if (actaRes.rows.length === 0) {
        const numActa = `ACTA-INV-${periodo.replace('-', '')}-01`;
        await db.execute({
          sql: `INSERT INTO actas_toma_fisica (periodo, numero_acta, estatus, tasa_bcv, auditor_tienda, gerente_dg67, contador_ucg, updated_at)
                VALUES (?, ?, 'ABIERTA', ?, 'Personal de Almacén / Auditor DG 67', 'Gerencia General DG 67', 'Contador Público Colegiado (C.P.C.)', datetime('now', 'localtime'))
                ON CONFLICT(periodo) DO NOTHING`,
          args: [periodo, numActa, tasaVigente]
        }).catch(() => {});

        return jsonResponse({
          periodo,
          estatus: 'ABIERTA',
          numero_acta: numActa,
          tasa_bcv: tasaVigente,
          auditor_tienda: 'Personal de Almacén / Auditor DG 67',
          gerente_dg67: 'Gerencia General DG 67',
          contador_ucg: 'Contador Público Colegiado (C.P.C.)',
          fecha_cierre: null,
          usuario_cierre: null
        });
      }
      const a = actaRes.rows[0];
      return jsonResponse({
        periodo: a.periodo,
        estatus: a.estatus || 'ABIERTA',
        numero_acta: a.numero_acta,
        fecha_corte: a.fecha_corte,
        fecha_cierre: a.fecha_cierre,
        usuario_cierre: a.usuario_cierre,
        auditor_tienda: a.auditor_tienda,
        gerente_dg67: a.gerente_dg67,
        contador_ucg: a.contador_ucg,
        tasa_bcv: Number(a.tasa_bcv || tasaVigente)
      });
    }

    if (path === '/api/auditoria/toma-fisica/apertura' && method === 'POST') {
      const body = await request.json();
      const periodo = body?.periodo || '2026-10';
      const numActaFinal = body?.numero_acta || body?.numero || `ACTA-INV-${periodo.replace('-', '')}-01`;
      const fechaCorteFinal = body?.fecha_corte || body?.fecha || new Date().toLocaleDateString('en-CA');
      const tasaBcvFinal = Number(body?.tasa_bcv) > 0 ? Number(body.tasa_bcv) : 889.58;
      const auditorTienda = body?.auditor_tienda || 'Personal de Almacén / Auditor DG 67';
      const gerenteDg67 = body?.gerente_dg67 || 'Gerencia General DG 67';
      const contadorUcg = body?.contador_ucg || 'Contador Público Colegiado (C.P.C.)';

      const prevActa = await db.execute({ sql: "SELECT estatus FROM actas_toma_fisica WHERE periodo = ? LIMIT 1", args: [periodo] }).catch(() => ({ rows: [] }));
      if (prevActa.rows[0]?.estatus === 'CERRADA') {
        return jsonResponse({ error: `El acta de Toma Física del período ${periodo} ya está cerrada. Reabra el acta para modificarla.` }, 409);
      }

      await db.execute({
        sql: `INSERT INTO actas_toma_fisica (periodo, numero_acta, estatus, fecha_corte, tasa_bcv, auditor_tienda, gerente_dg67, contador_ucg, updated_at)
              VALUES (?, ?, 'ABIERTA', ?, ?, ?, ?, ?, datetime('now', 'localtime'))
              ON CONFLICT(periodo) DO UPDATE SET
                numero_acta = excluded.numero_acta,
                fecha_corte = COALESCE(excluded.fecha_corte, actas_toma_fisica.fecha_corte),
                tasa_bcv = excluded.tasa_bcv,
                auditor_tienda = excluded.auditor_tienda,
                gerente_dg67 = excluded.gerente_dg67,
                contador_ucg = excluded.contador_ucg,
                updated_at = datetime('now', 'localtime')`,
        args: [periodo, numActaFinal, fechaCorteFinal, tasaBcvFinal, auditorTienda, gerenteDg67, contadorUcg]
      });

      return jsonResponse({
        success: true,
        periodo,
        estatus: 'ABIERTA',
        numero_acta: numActaFinal,
        fecha_corte: fechaCorteFinal,
        tasa_bcv: tasaBcvFinal
      });
    }

    if (path === '/api/auditoria/toma-fisica/cerrar' && method === 'POST') {
      const body = await request.json();
      const periodo = body?.periodo || '2026-10';
      const prevRes = await db.execute({ sql: "SELECT numero_acta, tasa_bcv FROM actas_toma_fisica WHERE periodo = ? LIMIT 1", args: [periodo] }).catch(() => ({ rows: [] }));
      const prevRow = prevRes.rows[0] || {};
      const numero_acta = body?.numero_acta || prevRow.numero_acta || `ACTA-INV-${periodo.replace('-', '')}-01`;
      const usuario = body?.usuario || 'ADMIN_DG67';
      const fecha_cierre = body?.fecha_cierre || new Date().toISOString();
      const auditor_tienda = body?.auditor_tienda || 'Personal de Almacén DG 67';
      const gerente_dg67 = body?.gerente_dg67 || 'Gerencia General Inversiones DG 67, C.A.';
      const contador_ucg = body?.contador_ucg || 'Contador Público Colegiado (C.P.C.)';
      const tasa_bcv = Number(body?.tasa_bcv) > 0 ? Number(body.tasa_bcv) : Number(prevRow.tasa_bcv || 889.58);

      const resumenRes = await db.execute("SELECT COUNT(*) as total, SUM(CASE WHEN auditado=1 THEN 1 ELSE 0 END) as auditados FROM productos").catch(() => ({ rows: [] }));
      const resumenJson = JSON.stringify(resumenRes.rows[0] || {});

      await db.execute({
        sql: `
          INSERT INTO actas_toma_fisica 
          (periodo, numero_acta, estatus, fecha_corte, fecha_cierre, usuario_cierre, auditor_tienda, gerente_dg67, contador_ucg, tasa_bcv, resumen_items, updated_at)
          VALUES (?, ?, 'CERRADA', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
          ON CONFLICT(periodo) DO UPDATE SET
            numero_acta = excluded.numero_acta,
            estatus = 'CERRADA',
            fecha_cierre = excluded.fecha_cierre,
            usuario_cierre = excluded.usuario_cierre,
            auditor_tienda = excluded.auditor_tienda,
            gerente_dg67 = excluded.gerente_dg67,
            contador_ucg = excluded.contador_ucg,
            tasa_bcv = excluded.tasa_bcv,
            resumen_items = excluded.resumen_items,
            updated_at = datetime('now', 'localtime')
        `,
        args: [periodo, numero_acta, fecha_cierre.slice(0, 10), fecha_cierre, usuario, auditor_tienda, gerente_dg67, contador_ucg, tasa_bcv, resumenJson]
      });

      return jsonResponse({
        success: true,
        periodo,
        numero_acta,
        estatus: 'CERRADA',
        fecha_cierre,
        usuario_cierre: usuario,
        tasa_bcv,
        mensaje: `Toma Física del período ${periodo} cerrada y sellada.`
      });
    }

    if (path === '/api/auditoria/toma-fisica/reabrir' && method === 'POST') {
      const body = await request.json();
      const { periodo = '2026-10' } = body || {};
      await db.execute({
        sql: `UPDATE actas_toma_fisica SET estatus = 'ABIERTA', updated_at = datetime('now', 'localtime') WHERE periodo = ?`,
        args: [periodo]
      });
      return jsonResponse({
        success: true,
        periodo,
        estatus: 'ABIERTA',
        mensaje: `🔓 Toma Física del período ${periodo} reabierta para ajustes y rectificaciones.`
      });
    }

    // ----------------------------------------------------
    // TASAS BCV
    // ----------------------------------------------------
    if (path === '/api/tasas-bcv' && method === 'GET') {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS historico_tasas_bcv (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha TEXT NOT NULL,
          hora TEXT NOT NULL,
          timestamp INTEGER,
          tasa_bcv REAL NOT NULL,
          moneda TEXT DEFAULT 'USD',
          usuario TEXT,
          origen TEXT DEFAULT 'MANUAL_MODAL'
        );
      `).catch(() => {});

      const [tasasRes, cfgRes] = await Promise.all([
        db.execute("SELECT * FROM tasas_bcv_periodo ORDER BY periodo ASC"),
        db.execute("SELECT metodo_valoracion_kardex, tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1")
      ]);
      const tasas = tasasRes.rows;
      const cfg = cfgRes.rows[0] || {};
      const latestTasa = tasas.length > 0 ? tasas[tasas.length - 1] : null;

      const tasaActiva = (cfg.tasa_bcv_activa_dia && Number(cfg.tasa_bcv_activa_dia) > 0)
        ? {
            tasa_bcv: Number(cfg.tasa_bcv_activa_dia),
            fecha: cfg.fecha_bcv_activa_dia || new Date().toISOString().split('T')[0],
            periodo: (cfg.fecha_bcv_activa_dia || new Date().toISOString()).slice(0, 7),
            moneda: 'USD',
            origen: 'DIARIA_ACTIVA'
          }
        : (latestTasa ? {
            tasa_bcv: latestTasa.tasa_bcv,
            fecha: latestTasa.fecha_cierre,
            periodo: latestTasa.periodo,
            moneda: latestTasa.moneda || 'USD',
            origen: 'CIERRE_MES'
          } : { tasa_bcv: 889.58, fecha: '2026-10-30', periodo: '2026-10', moneda: 'USD', origen: 'DEFAULT' });

      const fechaFiltro = tasaActiva.fecha || new Date().toISOString().split('T')[0];
      const histRes = await db.execute({
        sql: "SELECT * FROM historico_tasas_bcv WHERE fecha = ? ORDER BY id DESC LIMIT 25",
        args: [fechaFiltro]
      }).catch(() => ({ rows: [] }));

      return jsonResponse({
        metodo_valoracion_kardex: cfg.metodo_valoracion_kardex || 'CPP',
        tasas,
        tasa_activa: tasaActiva,
        historico_hoy: histRes.rows || []
      });
    }

    if (path === '/api/tasas-bcv/diaria' && method === 'POST') {
      const b = await request.json();
      const numTasa = parseFloat(b.tasa_bcv);
      if (!numTasa || numTasa <= 0) return jsonResponse({ error: 'Monto de tasa BCV inválido' }, 400);

      const fechaTasa = b.fecha || new Date().toISOString().split('T')[0];
      const periodo = fechaTasa.slice(0, 7);
      const usuario = b.usuario || 'ADMIN_DG67';
      const ahora = new Date();
      const hora = ahora.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      const timestamp = ahora.getTime();

      await db.execute(`
        CREATE TABLE IF NOT EXISTS historico_tasas_bcv (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha TEXT NOT NULL,
          hora TEXT NOT NULL,
          timestamp INTEGER,
          tasa_bcv REAL NOT NULL,
          moneda TEXT DEFAULT 'USD',
          usuario TEXT,
          origen TEXT DEFAULT 'MANUAL_MODAL'
        );
      `).catch(() => {});

      await db.execute({
        sql: `UPDATE config_fiscal_islr SET tasa_bcv_activa_dia = ?, fecha_bcv_activa_dia = ? WHERE id = 1`,
        args: [numTasa, fechaTasa]
      });

      await db.execute({
        sql: `INSERT INTO historico_tasas_bcv (fecha, hora, timestamp, tasa_bcv, moneda, usuario, origen) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [fechaTasa, hora, timestamp, numTasa, b.moneda || 'USD', usuario, 'MODAL_DIARIO']
      });

      const histRes = await db.execute({
        sql: "SELECT * FROM historico_tasas_bcv WHERE fecha = ? ORDER BY id DESC LIMIT 25",
        args: [fechaTasa]
      }).catch(() => ({ rows: [] }));

      return jsonResponse({
        ok: true,
        mensaje: `Tasa BCV actualizada: Bs. ${numTasa.toFixed(4)} (${fechaTasa})`,
        tasa_bcv: numTasa,
        fecha: fechaTasa,
        periodo,
        historico_hoy: histRes.rows || []
      });
    }

    if (path === '/api/tasas-bcv/historico' && method === 'GET') {
      const fechaQuery = url.searchParams.get('fecha') || new Date().toISOString().split('T')[0];
      await db.execute(`
        CREATE TABLE IF NOT EXISTS historico_tasas_bcv (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha TEXT NOT NULL,
          hora TEXT NOT NULL,
          timestamp INTEGER,
          tasa_bcv REAL NOT NULL,
          moneda TEXT DEFAULT 'USD',
          usuario TEXT,
          origen TEXT DEFAULT 'MANUAL_MODAL'
        );
      `).catch(() => {});

      const histRes = await db.execute({
        sql: "SELECT * FROM historico_tasas_bcv WHERE fecha = ? ORDER BY id DESC LIMIT 50",
        args: [fechaQuery]
      });

      return jsonResponse({
        fecha: fechaQuery,
        historico: histRes.rows || []
      });
    }

    if (path === '/api/tasas-bcv/revalorizar-cierre' && method === 'PUT') {
      const b = await request.json();
      const { tasas = [], metodo_valoracion_kardex } = b;

      if (metodo_valoracion_kardex && ['CPP', 'PEPS'].includes(metodo_valoracion_kardex)) {
        await db.execute({
          sql: "UPDATE config_fiscal_islr SET metodo_valoracion_kardex = ? WHERE id = 1",
          args: [metodo_valoracion_kardex]
        });
      }

      if (Array.isArray(tasas) && tasas.length > 0) {
        for (const t of tasas) {
          if (!t.periodo || !(Number(t.tasa_bcv) > 0)) continue;
          await db.execute({
            sql: `INSERT OR REPLACE INTO tasas_bcv_periodo (periodo, tasa_bcv, fecha_cierre, moneda, fuente)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              t.periodo,
              Number(t.tasa_bcv),
              t.fecha_cierre || `${t.periodo}-28`,
              t.moneda || 'USD',
              t.fuente || `Tasa Oficial BCV al Cierre del Período ${t.periodo}`
            ]
          });
        }
      }

      // Revalorizar únicamente períodos NO DECLARADOS y sin sobrescribir tasas diarias históricas ya asentadas (> 0)
      const condAbiertoMov = `NOT EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = substr(movimientos.fecha, 1, 7) AND d.estatus = 'DECLARADO') AND substr(movimientos.fecha, 1, 7) > '2026-09'`;
      const condAbiertoLC = `NOT EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_compras.periodo AND d.estatus = 'DECLARADO') AND libro_compras.periodo > '2026-09'`;
      const condAbiertoLV = `NOT EXISTS (SELECT 1 FROM declaraciones_iva d WHERE d.periodo = libro_ventas.periodo AND d.estatus = 'DECLARADO') AND libro_ventas.periodo > '2026-09'`;

      await db.execute(`
        UPDATE movimientos
        SET tasa_bcv = COALESCE(
              (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
              movimientos.tasa_bcv,
              889.58
            ),
            fecha_tasa_bcv = COALESCE(
              (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
              movimientos.fecha_tasa_bcv,
              movimientos.fecha
            )
        WHERE (${condAbiertoMov}) AND COALESCE(tasa_bcv, 0) <= 0
      `);

      await db.execute(`
        UPDATE movimiento_detalles
        SET tasa_bcv_operacion = COALESCE(
              (SELECT m.tasa_bcv FROM movimientos m WHERE m.id = movimiento_detalles.movimiento_id),
              movimiento_detalles.tasa_bcv_operacion
            ),
            costo_unitario_bs = ROUND(COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0) * COALESCE((SELECT m.tasa_bcv FROM movimientos m WHERE m.id = movimiento_detalles.movimiento_id), 889.58), 2),
            costo_unitario_ves = ROUND(COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0) * COALESCE((SELECT m.tasa_bcv FROM movimientos m WHERE m.id = movimiento_detalles.movimiento_id), 889.58), 2)
        WHERE COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0) > 0
          AND COALESCE(tasa_bcv_operacion, 0) <= 0
          AND movimiento_id IN (SELECT id FROM movimientos WHERE ${condAbiertoMov})
      `).catch(() => {});

      await db.execute(`
        UPDATE libro_compras
        SET tasa_bcv = COALESCE(
              (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
              libro_compras.tasa_bcv,
              889.58
            ),
            base_imponible_divisa = ROUND(COALESCE(base_imponible_bs, 0) / COALESCE(NULLIF(libro_compras.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo), 889.58), 2),
            monto_iva_divisa = ROUND(COALESCE(iva_bs, 0) / COALESCE(NULLIF(libro_compras.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo), 889.58), 2),
            total_divisa = ROUND(COALESCE(total_bs, 0) / COALESCE(NULLIF(libro_compras.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo), 889.58), 2)
        WHERE (${condAbiertoLC}) AND COALESCE(tasa_bcv, 0) <= 0
      `);

      await db.execute(`
        UPDATE libro_ventas
        SET tasa_bcv = COALESCE(
              (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
              libro_ventas.tasa_bcv,
              889.58
            ),
            exento_divisa = ROUND(COALESCE(exento_bs, 0) / COALESCE(NULLIF(libro_ventas.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo), 889.58), 2),
            base_imponible_divisa = ROUND(COALESCE(base_imponible_bs, 0) / COALESCE(NULLIF(libro_ventas.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo), 889.58), 2),
            monto_iva_divisa = ROUND(COALESCE(iva_bs, 0) / COALESCE(NULLIF(libro_ventas.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo), 889.58), 2),
            total_divisa = ROUND(COALESCE(total_bs, 0) / COALESCE(NULLIF(libro_ventas.tasa_bcv, 0), (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo), 889.58), 2)
        WHERE (${condAbiertoLV}) AND COALESCE(tasa_bcv, 0) <= 0
      `);

      return jsonResponse({
        success: true,
        message: 'Tasas de cierre actualizadas con resguardo de períodos cerrados y tasas diarias históricas.'
      });
    }

    // ----------------------------------------------------
    // MOVIMIENTOS (HISTORIAL & REGISTRO)
    // ----------------------------------------------------
    if (path === '/api/movimientos' && method === 'GET') {
      const tipo = url.searchParams.get('tipo');
      const subtipo = url.searchParams.get('subtipo');
      const desde = url.searchParams.get('desde');
      const hasta = url.searchParams.get('hasta');
      const q = url.searchParams.get('q');
      const limit = parseInt(url.searchParams.get('limit') || '200', 10);

      let sql = `
        SELECT 
          m.id, m.tipo,
          COALESCE(m.subtipo, m.tipo) as subtipo,
          m.fecha,
          COALESCE(m.fecha_factura, m.fecha) as fecha_factura,
          COALESCE(m.tasa_bcv_factura, m.tasa_bcv) as tasa_bcv_factura,
          m.numero_documento,
          COALESCE(m.nro_control, '-') as nro_control,
          COALESCE(m.usuario_responsable, 'ADMIN_SISTEMA') as usuario_responsable,
          COALESCE(m.tasa_bcv, 889.26) as tasa_bcv,
          m.observaciones,
          COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as proveedor_nombre,
          COALESCE(pr.rif, '-') as proveedor_rif,
          COUNT(md.id) as total_items,
          COALESCE(SUM(md.cantidad), 0) as total_unidades,
          ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd)), 0), 2) as total_usd,
          ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), p.costo_referencial_usd * COALESCE(m.tasa_bcv, 889.26))), 0), 2) as total_ves
        FROM movimientos m
        LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
        LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
        LEFT JOIN productos p ON md.producto_id = p.id
        WHERE 1=1
      `;
      const args = [];
      if (tipo && tipo !== 'TODOS') {
        sql += ` AND m.tipo = ?`;
        args.push(tipo);
      }
      if (subtipo && subtipo !== 'TODOS') {
        sql += ` AND COALESCE(m.subtipo, m.tipo) = ?`;
        args.push(subtipo);
      }
      if (desde) {
        sql += ` AND m.fecha >= ?`;
        args.push(desde);
      }
      if (hasta) {
        sql += ` AND m.fecha <= ?`;
        args.push(hasta);
      }
      if (q && q.trim() !== '') {
        sql += ` AND (m.numero_documento LIKE ? OR COALESCE(m.nro_control, '') LIKE ? OR COALESCE(m.observaciones, '') LIKE ? OR COALESCE(pr.razon_social, '') LIKE ? OR COALESCE(p.codigo, '') LIKE ? OR COALESCE(p.descripcion, '') LIKE ?)`;
        const term = `%${q.trim()}%`;
        args.push(term, term, term, term, term, term);
      }
      sql += ` GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC LIMIT ?`;
      args.push(limit);

      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/movimientos/verificar-duplicado-entrada' && method === 'GET') {
      const provId = url.searchParams.get('proveedor_id');
      const numDoc = url.searchParams.get('numero_documento');
      const excId = url.searchParams.get('exclude_id');
      const res = await verificarDuplicadoEntradaAlmacen(provId, numDoc, excId, db);
      return jsonResponse(res);
    }

    if (path.startsWith('/api/movimientos/') && method === 'GET') {
      const id = path.split('/')[3];
      const [hdr, dtl] = await Promise.all([
        db.execute({
          sql: `SELECT m.*, COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as proveedor_nombre, COALESCE(pr.rif, '-') as proveedor_rif
                FROM movimientos m LEFT JOIN proveedores pr ON m.proveedor_id = pr.id WHERE m.id = ?`,
          args: [id]
        }),
        db.execute({
          sql: `SELECT md.*, p.codigo, p.descripcion, p.unidad_medida
                FROM movimiento_detalles md JOIN productos p ON md.producto_id = p.id WHERE md.movimiento_id = ?`,
          args: [id]
        })
      ]);
      const hRow = hdr.rows[0] || null;
      return jsonResponse({
        header: hRow ? {
          ...hRow,
          leyenda_tasa_bcv: `Tasa Oficial BCV al ${hRow.fecha_tasa_bcv || hRow.fecha}: Bs. ${Number(hRow.tasa_bcv || 0).toFixed(2)}`
        } : null,
        detalles: dtl.rows,
        items: dtl.rows
      });
    }

    // ----------------------------------------------------
    // REGISTRAR MOVIMIENTO (DG67: SALIDAS / ENTRADAS CON TRAZABILIDAD Y CRUCE)
    // ----------------------------------------------------
    if (path === '/api/movimientos' && method === 'POST') {
      const body = await request.json();
      const {
        tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable,
        documento_afectado, tasa_bcv, proveedor_id, observaciones, items,
        fecha_factura, tasa_bcv_factura, metodo_valoracion
      } = body;

      if (!tipo || !['ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE'].includes(tipo)) {
        return jsonResponse({ error: 'Tipo de movimiento inválido.' }, 400);
      }
      if (!fecha) {
        return jsonResponse({ error: 'La fecha es obligatoria.' }, 400);
      }
      if (!numero_documento || String(numero_documento).trim() === '') {
        return jsonResponse({ error: 'El número de factura o documento es obligatorio.' }, 400);
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return jsonResponse({ error: 'Debe incluir al menos un artículo en la lista.' }, 400);
      }

      const subtipoNorm = subtipo || (tipo === 'ENTRADA_COMPRA' ? 'COMPRA_NACIONAL' : (tipo === 'SALIDA_VENTA' ? 'VENTA' : 'AJUSTE'));
      const subUpper = String(subtipoNorm).toUpperCase();
      const usuarioNorm = (usuario_responsable && String(usuario_responsable).trim()) || 'CAJA_DG67';
      const periodoMov = String(fecha).slice(0, 7);
      const docClean = String(numero_documento).trim();

      if (await isPeriodoDeclarado(periodoMov, db)) {
        if (subtipoNorm !== 'COMPRA_EXTEMPORANEA_INVENTARIO' && !body.solo_inventario) {
          return jsonResponse({
            error: `El período ${periodoMov} ya está DECLARADO y CERRADO ante el SENIAT. No se permiten nuevos movimientos en meses cerrados.`
          }, 403);
        }
      }

      // Validar cantidades positivas y existencia de productos antes de crear cabecera
      const parsedItems = [];
      for (const it of items) {
        const pid = parseInt(it.producto_id, 10);
        const qty = Number(it.cantidad);
        if (!pid || !Number.isFinite(qty) || qty <= 0) {
          return jsonResponse({ error: 'Todas las cantidades de artículos deben ser mayores a cero.' }, 400);
        }
        parsedItems.push({ ...it, producto_id: pid, cantidad: qty });
      }

      // Precarga en bloque de stock actual y costo referencial (0 consultas N+1)
      const uniqueProdIds = Array.from(new Set(parsedItems.map(it => it.producto_id)));
      const phIds = uniqueProdIds.map(() => '?').join(',');
      const prodsSnapRes = await db.execute({
        sql: `SELECT p.id AS producto_id, p.codigo, p.descripcion, COALESCE(p.costo_referencial_usd, 0) AS costo_referencial_usd, COALESCE(v.stock_actual, 0) AS stock_actual
              FROM productos p
              LEFT JOIN vista_inventario_actual v ON p.id = v.producto_id
              WHERE p.id IN (${phIds})`,
        args: uniqueProdIds
      });
      const prodSnapMap = new Map();
      for (const r of (prodsSnapRes.rows || [])) {
        prodSnapMap.set(Number(r.producto_id), {
          codigo: r.codigo,
          descripcion: r.descripcion,
          costo_referencial_usd: Number(r.costo_referencial_usd || 0),
          stock_actual: Number(r.stock_actual || 0)
        });
      }
      for (const pid of uniqueProdIds) {
        if (!prodSnapMap.has(pid)) {
          return jsonResponse({ error: 'Uno de los artículos seleccionados no existe en el catálogo.' }, 400);
        }
      }

      const isAjusteSalida = (tipo === 'AJUSTE' && !subUpper.includes('POSITIVO') && !subUpper.includes('SOBRANTE') && !subUpper.includes('ENTRADA') && !subUpper.includes('OMISION') && !subUpper.includes('RECLASIF') && !subUpper.includes('DEVOLUCION'));
      if (tipo === 'SALIDA_VENTA' || isAjusteSalida) {
        const requestedByProd = new Map();
        for (const it of parsedItems) {
          requestedByProd.set(it.producto_id, (requestedByProd.get(it.producto_id) || 0) + it.cantidad);
        }
        for (const [pid, qtyReq] of requestedByProd.entries()) {
          const stRow = prodSnapMap.get(pid);
          const disp = Number(stRow?.stock_actual || 0);
          if (disp < qtyReq) {
            return jsonResponse({
              error: `Stock insuficiente para [${stRow.codigo}] ${stRow.descripcion}: disponible ${disp} unds, solicitado ${qtyReq} unds.`
            }, 400);
          }
        }
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodoMov] });
      const tasaDefaultMes = Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : tasaDefaultMes;
      const fechaTasaMes = body.fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
      const ctrlNorm = (nro_control && String(nro_control).trim()) || (tipo === 'ENTRADA_COMPRA' ? '00-S/CTRL' : 'Z0A0000176');
      const metodoVal = ['CPP', 'PEPS'].includes(String(metodo_valoracion || '').toUpperCase()) ? String(metodo_valoracion).toUpperCase() : 'CPP';

      const numFacturaNum = normalizeFactNum(docClean);

      // VALIDACIÓN ANTI-DUPLICADOS PARA ENTRADAS DE ALMACÉN (con o sin proveedor)
      if (tipo === 'ENTRADA_COMPRA') {
        if (proveedor_id) {
          const dupEnt = await verificarDuplicadoEntradaAlmacen(proveedor_id, docClean, null, db);
          if (dupEnt.duplicado) {
            return jsonResponse({ error: dupEnt.mensaje, duplicado: true, detalle: dupEnt }, 409);
          }
        } else {
          const dupNoProv = await db.execute({
            sql: "SELECT id FROM movimientos WHERE tipo = 'ENTRADA_COMPRA' AND fecha = ? AND UPPER(TRIM(numero_documento)) = UPPER(?) LIMIT 1",
            args: [fecha, docClean]
          });
          if (dupNoProv.rows.length > 0) {
            return jsonResponse({
              error: `Ya existe una entrada registrada el ${fecha} con el documento N° ${docClean}.`,
              duplicado: true
            }, 409);
          }
        }
      }

      // VALIDACIÓN ANTI-DUPLICADOS PARA SALIDAS (Global para facturas de VENTA fiscal; por fecha+subtipo para salidas internas)
      const esVentaFiscal = (tipo === 'SALIDA_VENTA' && subUpper === 'VENTA');
      if (tipo === 'SALIDA_VENTA') {
        if (esVentaFiscal) {
          const dupVta = await db.execute({
            sql: `SELECT id, fecha FROM movimientos
                  WHERE tipo = 'SALIDA_VENTA'
                    AND COALESCE(subtipo, 'VENTA') = 'VENTA'
                    AND (UPPER(TRIM(numero_documento)) = UPPER(?) ${numFacturaNum ? 'OR (numero_factura_numerico IS NOT NULL AND numero_factura_numerico = ?)' : ''})
                  LIMIT 1`,
            args: numFacturaNum ? [docClean, numFacturaNum] : [docClean]
          });
          if (dupVta.rows.length > 0) {
            return jsonResponse({
              error: `La factura de venta N° ${docClean} ya fue registrada previamente (Fecha: ${dupVta.rows[0].fecha}).`,
              duplicado: true
            }, 409);
          }
        } else {
          const dupInt = await db.execute({
            sql: `SELECT id FROM movimientos WHERE tipo = 'SALIDA_VENTA' AND subtipo = ? AND fecha = ? AND UPPER(TRIM(numero_documento)) = UPPER(?) LIMIT 1`,
            args: [subtipoNorm, fecha, docClean]
          });
          if (dupInt.rows.length > 0) {
            return jsonResponse({
              error: `Ya existe una salida interna (${subtipoNorm}) con el documento N° ${docClean} en la fecha ${fecha}.`,
              duplicado: true
            }, 409);
          }
        }
      }

      const estatusInicial = (tipo === 'SALIDA_VENTA' && !esVentaFiscal) ? 'NO_APLICA_INTERNO' : 'PENDIENTE_UCG';
      const headerResult = await db.execute({
        sql: `INSERT INTO movimientos 
              (tipo, subtipo, fecha, fecha_factura, tasa_bcv_factura, numero_documento, numero_factura_numerico, nro_control, usuario_responsable,
               documento_afectado, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, proveedor_id, observaciones,
               estatus_conciliacion)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING id`,
        args: [
          tipo, subtipoNorm, fecha, fecha_factura || fecha, Number(tasa_bcv_factura) > 0 ? Number(tasa_bcv_factura) : tasaNum,
          docClean, numFacturaNum, ctrlNorm, usuarioNorm,
          documento_afectado || '', tasaNum, fechaTasaMes, body.moneda_operacion || 'USD', metodoVal,
          proveedor_id ? parseInt(proveedor_id, 10) : null, observaciones || '', estatusInicial
        ]
      });

      const movimientoId = Number(headerResult.rows[0]?.id || headerResult.lastInsertRowid);
      const aplicaIvaMov = (tipo === 'ENTRADA_COMPRA' && !subUpper.includes('AJUSTE')) ||
                           (tipo === 'SALIDA_VENTA' && (subUpper === 'VENTA' || subUpper.includes('RETIRO')));
      const pctIvaMov = aplicaIvaMov ? 0.16 : 0;

      const detailStatements = [];
      const runningStockCpp = new Map();
      for (const [pid, snap] of prodSnapMap.entries()) {
        runningStockCpp.set(pid, { stock: snap.stock_actual, costoUsd: snap.costo_referencial_usd });
      }

      for (const it of parsedItems) {
        const pid = it.producto_id;
        const qty = it.cantidad;
        const tasaItem = Number(it.tasa_bcv_operacion || tasaNum) > 0 ? Number(it.tasa_bcv_operacion || tasaNum) : tasaNum;
        const snap = runningStockCpp.get(pid);

        let cDivisa = parseFloat(it.costo_unitario_divisa || it.costo_unitario_usd || 0);
        let cBs = parseFloat(it.costo_unitario_bs || it.costo_unitario_ves || 0);
        if (cDivisa <= 0 && cBs > 0) cDivisa = Number((cBs / tasaItem).toFixed(2));
        if (cDivisa <= 0) cDivisa = Number(snap?.costoUsd || 0);
        if (cBs <= 0) cBs = Number((cDivisa * tasaItem).toFixed(2));

        const precioUnitDiv = parseFloat(it.precio_unitario_divisa || cDivisa);
        const precioUnitBs = parseFloat(it.precio_unitario_bs || Number((precioUnitDiv * tasaItem).toFixed(2)));
        const baseDiv = Number((qty * precioUnitDiv).toFixed(2));
        const baseBs = Number((qty * precioUnitBs).toFixed(2));
        const ivaDiv = Number((baseDiv * pctIvaMov).toFixed(2));
        const ivaBs = Number((baseBs * pctIvaMov).toFixed(2));
        const totDiv = Number((baseDiv + ivaDiv).toFixed(2));
        const totBs = Number((baseBs + ivaBs).toFixed(2));

        detailStatements.push({
          sql: `INSERT INTO movimiento_detalles (
                  movimiento_id, producto_id, cantidad,
                  costo_unitario_usd, costo_unitario_ves,
                  costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs,
                  precio_unitario_bs, precio_unitario_divisa,
                  base_imponible_bs, base_imponible_divisa,
                  monto_iva_bs, monto_iva_divisa,
                  total_linea_bs, total_linea_divisa
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            movimientoId, pid, qty,
            cDivisa, cBs,
            cDivisa, tasaItem, cBs,
            precioUnitBs, precioUnitDiv,
            baseBs, baseDiv,
            ivaBs, ivaDiv,
            totBs, totDiv
          ]
        });

        // Recalcular Costo Promedio Ponderado (CPP) y actualizar productos.costo_referencial_usd en el mismo batch atómico
        if (tipo === 'ENTRADA_COMPRA' && cDivisa > 0 && snap) {
          const stockAnt = Math.max(0, Number(snap.stock || 0));
          const costoAnt = Number(snap.costoUsd || 0);
          const nuevoStock = stockAnt + qty;
          const nuevoCppUsd = (stockAnt > 0 && costoAnt > 0)
            ? Number((((stockAnt * costoAnt) + (qty * cDivisa)) / nuevoStock).toFixed(4))
            : Number(cDivisa.toFixed(4));
          snap.stock = nuevoStock;
          snap.costoUsd = nuevoCppUsd;
          detailStatements.push({
            sql: "UPDATE productos SET costo_referencial_usd = ? WHERE id = ?",
            args: [Number(nuevoCppUsd.toFixed(2)), pid]
          });
        }
      }

      try {
        await db.batch(detailStatements, 'write');
      } catch (batchErr) {
        await db.execute({ sql: "DELETE FROM movimientos WHERE id = ?", args: [movimientoId] }).catch(() => {});
        throw batchErr;
      }

      let resultadoCruce = null;
      if (tipo === 'SALIDA_VENTA') {
        if (esVentaFiscal) {
          const zId = body.libro_ventas_id ? parseInt(body.libro_ventas_id, 10) : null;
          if (zId) {
            await db.execute({
              sql: "UPDATE movimientos SET libro_ventas_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?",
              args: [zId, movimientoId]
            });
            resultadoCruce = await conciliarReporteZ(zId, db);
          } else {
            resultadoCruce = await conciliarVentaIndividual(movimientoId, db);
          }
        } else {
          resultadoCruce = { estatus: 'NO_APLICA_INTERNO', mensaje: 'Salida interna registrada sin afectación a Reporte Z.' };
        }
      } else if (tipo === 'ENTRADA_COMPRA') {
        let lcId = body.libro_compras_id || null;
        if (!lcId && numFacturaNum) {
          let sqlMatch = `SELECT id FROM libro_compras WHERE aplica_inventario = 1 AND (libro_compras.movimiento_id IS NULL OR libro_compras.movimiento_id = 0) AND (UPPER(TRIM(nro_factura)) = UPPER(?) OR CAST(LTRIM(REPLACE(nro_factura, '-', ''), '0') AS INTEGER) = ?)`;
          const argsMatch = [docClean, numFacturaNum];
          if (proveedor_id) {
            sqlMatch += ` AND proveedor_id = ?`;
            argsMatch.push(parseInt(proveedor_id, 10));
          }
          sqlMatch += ` LIMIT 1`;
          const matchLC = await db.execute({ sql: sqlMatch, args: argsMatch });
          if (matchLC.rows.length > 0) {
            lcId = matchLC.rows[0].id;
          }
        }
        if (lcId) {
          await Promise.all([
            db.execute({ sql: "UPDATE movimientos SET libro_compras_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?", args: [lcId, movimientoId] }),
            db.execute({ sql: "UPDATE libro_compras SET movimiento_id = ?, estatus_conciliacion = 'CONCILIADO', observaciones_cruce = 'Conciliado con entrada de almacén #' || ? WHERE id = ?", args: [movimientoId, movimientoId, lcId] })
          ]);
          resultadoCruce = { estatus: 'CONCILIADO', libro_compras_id: lcId };
        }
      }

      return jsonResponse({
        success: true,
        message: `Movimiento registrado exitosamente (Bs. y $ USD).`,
        movimientoId,
        itemsCount: parsedItems.length,
        conciliacion: resultadoCruce
      });
    }

    // ----------------------------------------------------
    // CRUCE DE INFORMACIÓN DE DOBLE VÍA (DG67 ↔ UCG)
    // ----------------------------------------------------
    if (path === '/api/cruce/doble-via' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const resumen = await getResumenCruceDobleVia(periodo, db);
      return jsonResponse(resumen);
    }

    if (path === '/api/fiscal/proxima-factura-z' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const fecha = url.searchParams.get('fecha');
      const resultado = await getProximaFacturaZ(periodo, fecha, db);
      return jsonResponse(resultado);
    }

    if (path === '/api/fiscal/cruce-compras-entradas' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const resultado = await getCruceComprasEntradas(periodo, db);
      return jsonResponse(resultado);
    }

    if (path === '/api/cruce/ejecutar' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const periodo = body.periodo || '2026-10';
      const resumen = await getResumenCruceDobleVia(periodo, db);
      return jsonResponse({ success: true, resumen });
    }

    if (path === '/api/fiscal/conciliar-compra' && method === 'POST') {
      const body = await request.json();
      const { libro_compra_id, movimiento_id } = body;
      if (!libro_compra_id || !movimiento_id) {
        return jsonResponse({ error: 'Faltan parámetros libro_compra_id y movimiento_id' }, 400);
      }
      await Promise.all([
        db.execute({
          sql: "UPDATE libro_compras SET movimiento_id = ?, estatus_conciliacion = 'CONCILIADO', observaciones_cruce = 'Conciliado manualmente con entrada física en almacén' WHERE id = ?",
          args: [movimiento_id, libro_compra_id]
        }),
        db.execute({
          sql: "UPDATE movimientos SET libro_compras_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?",
          args: [libro_compra_id, movimiento_id]
        })
      ]);
      return jsonResponse({ success: true, message: 'Compra física y fiscal conciliada con éxito.' });
    }




    // ----------------------------------------------------
    // CONTROL FISCAL & SENIAT
    // ----------------------------------------------------
    if (path === '/api/fiscal/conciliar-factura' && method === 'POST') {
      const body = await request.json();
      const { libro_compra_id, movimiento_id, observaciones } = body;
      await db.execute({
        sql: `
          UPDATE libro_compras
          SET estatus_conciliacion = 'CONCILIADO',
              movimiento_id = ?,
              observaciones_cruce = ?
          WHERE id = ?
        `,
        args: [movimiento_id, observaciones || 'Conciliado manualmente con movimiento de almacén', libro_compra_id]
      });
      return jsonResponse({ success: true, message: 'Factura conciliada con éxito' });
    }

    if (path === '/api/fiscal/entradas-tienda' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const q = url.searchParams.get('q');
      const soloPendientes = url.searchParams.get('soloPendientes');
      let sql = `
        SELECT 
          m.id as movimiento_id,
          m.fecha,
          strftime('%Y-%m', m.fecha) as periodo,
          CASE 
            WHEN m.numero_documento IS NOT NULL AND m.numero_documento NOT LIKE 'COMPRA-%' AND m.numero_documento != 'CONTROL DE INVETRIO' THEN m.numero_documento
            WHEN m.observaciones IS NOT NULL AND m.observaciones != '' THEN m.observaciones
            ELSE m.numero_documento
          END as nro_factura_tienda,
          m.numero_documento,
          COALESCE(m.fecha_factura, m.fecha) as fecha_factura,
          m.fecha as fecha_recepcion,
          COALESCE(m.nro_control, '') as nro_control,
          COALESCE(m.tasa_bcv_factura, m.tasa_bcv, 889.58) as tasa_bcv_factura,
          COALESCE(m.tasa_bcv, 889.58) as tasa_bcv,
          COALESCE(m.fecha_tasa_bcv, m.fecha_factura, m.fecha) as fecha_tasa_bcv,
          m.observaciones,
          m.proveedor_id,
          COALESCE(pr.rif, 'S/RIF') as rif,
          COALESCE(pr.razon_social, 'Proveedor General') as razon_social,
          COALESCE(pr.tipo_servicio, 'MERCANCIA_REPUESTOS') as tipo_servicio,
          COALESCE(pr.aplica_inventario, 1) as aplica_inventario,
          COALESCE(pr.porcentaje_retencion, 0.0) as porcentaje_retencion,
          COUNT(md.id) as total_items,
          COALESCE(SUM(md.cantidad), 0) as total_unidades,
          COALESCE(SUM(COALESCE(md.base_imponible_bs, md.total_linea_bs, 0)), 0) as base_imponible_bs,
          COALESCE(SUM(COALESCE(md.base_imponible_divisa, md.total_linea_divisa, md.cantidad * md.costo_unitario_usd, 0)), 0) as base_imponible_divisa,
          COALESCE(SUM(COALESCE(md.monto_iva_bs, 0)), 0) as iva_bs,
          COALESCE(SUM(COALESCE(md.total_linea_bs, 0)), 0) as total_bs,
          COALESCE(SUM(COALESCE(md.total_linea_divisa, md.cantidad * md.costo_unitario_usd, 0)), 0) as total_usd,
          GROUP_CONCAT(COALESCE(p.codigo, 'PROD') || ' (' || CAST(md.cantidad AS INT) || ')', ', ') as resumen_productos,
          COALESCE(m.libro_compras_id, lc.id) as libro_compra_id
        FROM movimientos m
        LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
        LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
        LEFT JOIN productos p ON md.producto_id = p.id
        LEFT JOIN libro_compras lc ON (m.libro_compras_id = lc.id OR lc.movimiento_id = m.id)
        WHERE m.tipo = 'ENTRADA_COMPRA'
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND strftime('%Y-%m', m.fecha) = ?`;
        args.push(periodo);
      }
      if (q) {
        sql += ` AND (m.numero_documento LIKE ? OR m.observaciones LIKE ? OR pr.razon_social LIKE ? OR pr.rif LIKE ?)`;
        args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (soloPendientes === 'true' || soloPendientes === '1') {
        sql += ` AND m.libro_compras_id IS NULL AND lc.id IS NULL AND (m.estatus_conciliacion IS NULL OR m.estatus_conciliacion != 'CONCILIADO')`;
      }
      sql += `
        GROUP BY m.id
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 200
      `;
      const result = await db.execute({ sql, args });
      return jsonResponse(result.rows);
    }

    if (path === '/api/fiscal/salidas-tienda' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const fecha = url.searchParams.get('fecha');
      const q = url.searchParams.get('q');
      const result = await getSalidasTiendaAgrupadas(periodo, fecha, q, db);
      return jsonResponse(result);
    }

    if (path === '/api/fiscal/cruce-ventas-salidas' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const cruce = await getCruceVentasSalidas(periodo, db);
      return jsonResponse(cruce);
    }

    if (path === '/api/fiscal/verificar-duplicado-compra' && method === 'GET') {
      const rif = url.searchParams.get('rif');
      const numFact = url.searchParams.get('nro_factura');
      const numCtrl = url.searchParams.get('nro_control');
      const excId = url.searchParams.get('exclude_id');
      const res = await verificarDuplicadoLibroCompras(rif, numFact, numCtrl, excId, db);
      return jsonResponse(res);
    }

    if (path === '/api/fiscal/libro-compras' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const id = url.searchParams.get('id');
      const tipoServicio = url.searchParams.get('tipo_servicio');
      const estatus = url.searchParams.get('estatus');
      const aplicaInventario = url.searchParams.get('aplica_inventario');

      let sql = `
        SELECT 
          lc.*, 
          p.razon_social as proveedor_registrado_nombre,
          ri.id as retencion_islr_id,
          ri.nro_comprobante as comprobante_islr_emitido,
          COALESCE(rid.impuesto_retenido_bs, ri.total_islr_retenido_bs, 0) as islr_retenido_bs
        FROM libro_compras lc 
        LEFT JOIN proveedores p ON lc.proveedor_id = p.id 
        LEFT JOIN retenciones_islr_detalles rid ON rid.libro_compra_id = lc.id
        LEFT JOIN retenciones_islr ri ON ri.id = rid.retencion_id
        WHERE 1=1
      `;
      const args = [];
      if (id) {
        sql += ` AND lc.id = ?`;
        args.push(id);
      } else if (periodo && periodo !== 'TODOS') {
        sql += ` AND lc.periodo = ?`;
        args.push(periodo);
      }
      if (tipoServicio && tipoServicio !== 'TODOS') {
        sql += ` AND lc.tipo_servicio = ?`;
        args.push(tipoServicio);
      }
      if (estatus && estatus !== 'TODOS') {
        sql += ` AND lc.estatus_conciliacion = ?`;
        args.push(estatus);
      }
      if (aplicaInventario !== null && aplicaInventario !== undefined && aplicaInventario !== '' && aplicaInventario !== 'TODOS') {
        sql += ` AND lc.aplica_inventario = ?`;
        args.push(Number(aplicaInventario) ? 1 : 0);
      }
      sql += ` GROUP BY lc.id ORDER BY lc.fecha ASC, lc.nro_operacion ASC, lc.id ASC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/fiscal/libro-ventas' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const id = url.searchParams.get('id');
      let sql = `SELECT * FROM libro_ventas WHERE 1=1`;
      const args = [];
      if (id) {
        sql += ` AND id = ?`;
        args.push(id);
      } else if (periodo && periodo !== 'TODOS') {
        sql += ` AND periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY periodo ASC, fecha ASC, id ASC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if ((path === '/api/fiscal/libro-ventas' || path === '/api/cruce/reporte-z') && method === 'POST') {
      const body = await request.json();
      const {
        periodo, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
        cantidad_comprobantes, cantidad_anuladas, total_anulaciones_bs, facturas_anuladas_lista,
        total_bs, total_divisa, exento_bs, exento_divisa,
        base_imponible_bs, base_imponible_divisa, alicuota, iva_bs, monto_iva_divisa,
        tasa_bcv, fecha_tasa_bcv, moneda_divisa
      } = body;

      if (!periodo || !fecha) {
        return jsonResponse({ error: 'Faltan campos requeridos (Período y Fecha)' }, 400);
      }
      if (await isPeriodoDeclarado(periodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite agregar nuevas ventas en un período cerrado.`
        }, 403);
      }
      if (!numero_reporte_z || String(numero_reporte_z).trim() === '') {
        return jsonResponse({ error: 'El N° de Reporte Z es obligatorio según normativa SENIAT (Providencia 00071).' }, 400);
      }
      if (!serial_impresora || String(serial_impresora).trim() === '') {
        return jsonResponse({ error: 'El Serial de la Máquina Fiscal es obligatorio.' }, 400);
      }
      if (!factura_desde || !factura_hasta) {
        return jsonResponse({ error: 'El rango correlativo de facturas (Desde / Hasta) es obligatorio.' }, 400);
      }
      if (base_imponible_bs === undefined && base_imponible_divisa === undefined && exento_bs === undefined) {
        return jsonResponse({ error: 'Debe registrar la Base Imponible o Ventas Exentas.' }, 400);
      }

      const desdeN = normalizeFactNum(factura_desde);
      const hastaN = normalizeFactNum(factura_hasta);
      if (desdeN && hastaN && desdeN > hastaN) {
        return jsonResponse({ error: 'El rango de facturas es inválido: la factura Desde debe ser menor o igual a Hasta.' }, 400);
      }

      const numZ = String(numero_reporte_z || '').trim();
      const serial = String(serial_impresora || 'Z0A0000176').trim();
      const dupZ = await db.execute({
        sql: "SELECT id FROM libro_ventas WHERE fecha = ? AND UPPER(TRIM(numero_reporte_z)) = UPPER(?) AND UPPER(TRIM(serial_impresora)) = UPPER(?) LIMIT 1",
        args: [fecha, numZ, serial]
      });
      if (dupZ.rows.length > 0) {
        return jsonResponse({ error: `Ya existe el Reporte Z N° ${numZ} registrado el ${fecha} para la máquina ${serial}.` }, 409);
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
      const monedaOp = moneda_divisa || 'USD';

      const ali = parseAlicuotaDecimal(alicuota, 0.16);
      let baseBs = Number(base_imponible_bs) || 0.0;
      let baseDiv = Number(base_imponible_divisa) || 0.0;
      if (baseBs <= 0 && baseDiv > 0) baseBs = Number((baseDiv * tasaOp).toFixed(2));
      else if (baseDiv <= 0 && baseBs > 0) baseDiv = Number((baseBs / tasaOp).toFixed(2));

      let exBs = Number(exento_bs) || 0.0;
      let exDiv = Number(exento_divisa) || 0.0;
      if (exBs <= 0 && exDiv > 0) exBs = Number((exDiv * tasaOp).toFixed(2));
      else if (exDiv <= 0 && exBs > 0) exDiv = Number((exBs / tasaOp).toFixed(2));

      const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
      const ivaDivCalc = (monto_iva_divisa !== undefined && monto_iva_divisa !== null && monto_iva_divisa !== '') ? Number(monto_iva_divisa) : Number((ivaCalc / tasaOp).toFixed(2));
      const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaCalc + exBs).toFixed(2));
      const totalDivCalc = (total_divisa !== undefined && total_divisa !== null && total_divisa !== '') ? Number(total_divisa) : Number((totalCalc / tasaOp).toFixed(2));
      const cant = Number(cantidad_comprobantes) || 1;
      const cantAnul = Number(cantidad_anuladas) || 0;
      const totAnulBs = Number(total_anulaciones_bs) || 0.0;
      const anulLista = String(facturas_anuladas_lista || '').trim();

      const insResult = await db.execute({
        sql: `INSERT INTO libro_ventas 
              (periodo, archivo_origen, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
               total_bs, exento_bs, base_imponible_bs, alicuota, iva_bs, cantidad_comprobantes,
               cantidad_anuladas, total_anulaciones_bs, facturas_anuladas_lista,
               tasa_bcv, fecha_tasa_bcv, moneda_divisa, exento_divisa, base_imponible_divisa, monto_iva_divisa, total_divisa,
               estatus_conciliacion)
              VALUES (?, 'SISTEMA_WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE_DG67')
              RETURNING id`,
        args: [
          periodo, fecha, numZ, serial, factura_desde || null, factura_hasta || null,
          totalCalc, exBs, baseBs, ali, ivaCalc, cant,
          cantAnul, totAnulBs, anulLista,
          tasaOp, fechaTasaOp, monedaOp, exDiv, baseDiv, ivaDivCalc, totalDivCalc
        ]
      });

      const zId = Number(insResult.rows[0]?.id || insResult.lastInsertRowid);
      const resultadoCruce = await conciliarReporteZ(zId, db);
      await recalculateDeclaracionIva(periodo, db);

      return jsonResponse({
        success: true,
        id: zId,
        message: 'Reporte Z guardado con éxito en Libro de Ventas.',
        conciliacion: resultadoCruce
      });
    }

    if ((path.startsWith('/api/fiscal/libro-ventas/') && (method === 'PUT' || method === 'POST')) || (path === '/api/fiscal/libro-ventas' && method === 'PUT')) {
      const body = await request.json();
      const zId = parseInt(path === '/api/fiscal/libro-ventas' ? body.id : path.split('/').pop(), 10);
      if (!zId) return jsonResponse({ error: 'ID de Reporte Z inválido para actualización.' }, 400);

      const existingZ = await db.execute({ sql: "SELECT periodo FROM libro_ventas WHERE id = ?", args: [zId] });
      if (existingZ.rows.length === 0) return jsonResponse({ error: 'Reporte Z no encontrado.' }, 404);
      const oldPer = existingZ.rows[0]?.periodo;
      const targetPeriodo = body.periodo || oldPer;
      if ((await isPeriodoDeclarado(oldPer, db)) || (await isPeriodoDeclarado(targetPeriodo, db))) {
        return jsonResponse({
          error: `El período fiscal ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
        }, 403);
      }

      const {
        periodo, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
        cantidad_comprobantes, cantidad_anuladas, total_anulaciones_bs, facturas_anuladas_lista,
        total_bs, total_divisa, exento_bs, exento_divisa,
        base_imponible_bs, base_imponible_divisa, alicuota, iva_bs, monto_iva_divisa,
        tasa_bcv, fecha_tasa_bcv, moneda_divisa
      } = body;

      if (!periodo || !fecha) {
        return jsonResponse({ error: 'Faltan campos requeridos (Período y Fecha).' }, 400);
      }
      if (!numero_reporte_z || String(numero_reporte_z).trim() === '') {
        return jsonResponse({ error: 'El N° de Reporte Z es obligatorio (Providencia 00071).' }, 400);
      }
      if (!serial_impresora || String(serial_impresora).trim() === '') {
        return jsonResponse({ error: 'El Serial de la Máquina Fiscal es obligatorio.' }, 400);
      }
      if (!factura_desde || !factura_hasta) {
        return jsonResponse({ error: 'El rango correlativo de facturas (Desde / Hasta) es obligatorio.' }, 400);
      }
      const desdeN = normalizeFactNum(factura_desde);
      const hastaN = normalizeFactNum(factura_hasta);
      if (desdeN && hastaN && desdeN > hastaN) {
        return jsonResponse({ error: 'El rango de facturas es inválido: la factura Desde debe ser menor o igual a Hasta.' }, 400);
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
      const monedaOp = moneda_divisa || 'USD';

      const ali = parseAlicuotaDecimal(alicuota, 0.16);
      let baseBs = Number(base_imponible_bs) || 0.0;
      let baseDiv = Number(base_imponible_divisa) || 0.0;
      if (baseBs <= 0 && baseDiv > 0) baseBs = Number((baseDiv * tasaOp).toFixed(2));
      else if (baseDiv <= 0 && baseBs > 0) baseDiv = Number((baseBs / tasaOp).toFixed(2));

      let exBs = Number(exento_bs) || 0.0;
      let exDiv = Number(exento_divisa) || 0.0;
      if (exBs <= 0 && exDiv > 0) exBs = Number((exDiv * tasaOp).toFixed(2));
      else if (exDiv <= 0 && exBs > 0) exDiv = Number((exBs / tasaOp).toFixed(2));

      const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
      const ivaDivCalc = (monto_iva_divisa !== undefined && monto_iva_divisa !== null && monto_iva_divisa !== '') ? Number(monto_iva_divisa) : Number((ivaCalc / tasaOp).toFixed(2));
      const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaCalc + exBs).toFixed(2));
      const totalDivCalc = (total_divisa !== undefined && total_divisa !== null && total_divisa !== '') ? Number(total_divisa) : Number((totalCalc / tasaOp).toFixed(2));
      const cant = Number(cantidad_comprobantes) || 1;
      const numZ = String(numero_reporte_z || '').trim();
      const serial = String(serial_impresora || 'Z0A0000176').trim();
      const cantAnul = Number(cantidad_anuladas) || 0;
      const totAnulBs = Number(total_anulaciones_bs) || 0.0;
      const anulLista = String(facturas_anuladas_lista || '').trim();

      await db.execute({
        sql: `UPDATE libro_ventas SET 
                periodo = ?, fecha = ?, numero_reporte_z = ?, serial_impresora = ?, 
                factura_desde = ?, factura_hasta = ?, total_bs = ?, exento_bs = ?, 
                base_imponible_bs = ?, alicuota = ?, iva_bs = ?, cantidad_comprobantes = ?, 
                cantidad_anuladas = ?, total_anulaciones_bs = ?, facturas_anuladas_lista = ?, 
                tasa_bcv = ?, fecha_tasa_bcv = ?, moneda_divisa = ?, exento_divisa = ?, 
                base_imponible_divisa = ?, monto_iva_divisa = ?, total_divisa = ?
              WHERE id = ?`,
        args: [
          periodo, fecha, numZ, serial, factura_desde || null, factura_hasta || null,
          totalCalc, exBs, baseBs, ali, ivaCalc, cant,
          cantAnul, totAnulBs, anulLista,
          tasaOp, fechaTasaOp, monedaOp, exDiv, baseDiv, ivaDivCalc, totalDivCalc,
          zId
        ]
      });

      const resultadoCruce = await conciliarReporteZ(zId, db);
      await recalculateDeclaracionIva(periodo, db);
      if (oldPer && oldPer !== periodo) await recalculateDeclaracionIva(oldPer, db);

      return jsonResponse({
        success: true,
        id: zId,
        message: 'Reporte Z actualizado con éxito en el Libro de Ventas.',
        conciliacion: resultadoCruce
      });
    }

    if (path.startsWith('/api/fiscal/libro-ventas/') && method === 'DELETE') {
      const zId = parseInt(path.split('/').pop(), 10);
      const existingZ = await db.execute({ sql: "SELECT periodo FROM libro_ventas WHERE id = ?", args: [zId] });
      const targetPeriodo = existingZ.rows[0]?.periodo;
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite eliminar registros de un período cerrado.`
        }, 403);
      }
      await db.execute({ sql: "UPDATE movimientos SET libro_ventas_id = NULL, estatus_conciliacion = 'PENDIENTE_UCG' WHERE libro_ventas_id = ?", args: [zId] }).catch(() => {});
      await db.execute({ sql: "DELETE FROM libro_ventas WHERE id = ?", args: [zId] });
      await recalculateDeclaracionIva(targetPeriodo, db);
      return jsonResponse({ success: true, message: 'Registro de venta eliminado del Libro de Ventas.' });
    }

    if (path === '/api/fiscal/compras/solo-inventario' && method === 'POST') {
      const body = await request.json();
      const {
        fecha, rif, razon_social, nro_factura, nro_control,
        base_imponible_bs, alicuota, iva_bs, total_bs,
        tasa_bcv, observaciones, items
      } = body;

      if (!fecha || !rif || !nro_factura) {
        return jsonResponse({ error: 'Faltan campos obligatorios (Fecha, RIF, N° Factura)' }, 400);
      }

      const cleanRif = String(rif).trim().toUpperCase();
      const cleanRazon = String(razon_social || 'PROVEEDOR GENERAL').trim();
      const cleanFact = String(nro_factura).trim();
      const cleanCtrl = String(nro_control || '00-000000').trim();

      // 1. Obtener o auto-registrar proveedor
      let provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE UPPER(REPLACE(REPLACE(REPLACE(rif, '-', ''), '.', ''), ' ', '')) = UPPER(REPLACE(REPLACE(REPLACE(?, '-', ''), '.', ''), ' ', '')) LIMIT 1", args: [cleanRif] });
      let provId = provRes.rows[0]?.id || null;
      if (!provId) {
        try {
          const insProv = await db.execute({
            sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
                  VALUES (?, ?, 'MERCANCIA_REPUESTOS', 1, 0.0) RETURNING id`,
            args: [cleanRif, cleanRazon]
          });
          provId = Number(insProv.rows[0]?.id || insProv.lastInsertRowid);
        } catch (e) {
          console.warn('Error registrando proveedor para solo-inventario:', e.message);
        }
      }

      // 2. Verificar si ya existe movimiento de almacén para esta factura
      const numFacturaNum = normalizeFactNum(cleanFact);

      const dupCheck = await db.execute({
        sql: `SELECT id FROM movimientos 
              WHERE tipo = 'ENTRADA_COMPRA' 
                AND (
                  (proveedor_id = ? AND (numero_documento = ? OR (numero_factura_numerico IS NOT NULL AND numero_factura_numerico = ?)))
                  OR (numero_documento = ? AND proveedor_id = ?)
                )
              LIMIT 1`,
        args: [provId, cleanFact, numFacturaNum || -1, cleanFact, provId]
      });

      if (dupCheck.rows.length > 0) {
        return jsonResponse({
          success: true,
          duplicado: true,
          movimientoId: dupCheck.rows[0].id,
          message: `La factura [${cleanFact}] ya cuenta con entrada en almacén (Movimiento #${dupCheck.rows[0].id}).`
        });
      }

      // 3. Tasa BCV oficial de la fecha o período
      const periodoMov = String(fecha).slice(0, 7);
      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodoMov] });
      const tasaDefaultMes = Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : tasaDefaultMes;

      const aliDec = parseAlicuotaDecimal(alicuota, 0.16);
      const baseBs = Number(base_imponible_bs) || 0.0;
      const ivaBs = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * aliDec).toFixed(2));
      const totBs = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaBs).toFixed(2));
      const baseDiv = Number((baseBs / tasaOp).toFixed(2));
      const totDiv = Number((totBs / tasaOp).toFixed(2));

      // 4. Verificar si existe registro previo en libro_compras de algún mes anterior (ej. F0029250 en 2026-08)
      let lcId = null;
      try {
        const matchLC = await db.execute({
          sql: `SELECT id FROM libro_compras 
                WHERE UPPER(REPLACE(REPLACE(REPLACE(rif, '-', ''), '.', ''), ' ', '')) = UPPER(REPLACE(REPLACE(REPLACE(?, '-', ''), '.', ''), ' ', ''))
                  AND (UPPER(TRIM(nro_factura)) = UPPER(?) ${numFacturaNum ? 'OR (CAST(nro_factura AS INTEGER) > 0 AND CAST(nro_factura AS INTEGER) = ?)' : ''})
                LIMIT 1`,
          args: numFacturaNum ? [cleanRif, cleanFact, numFacturaNum] : [cleanRif, cleanFact]
        });
        if (matchLC.rows.length > 0) {
          lcId = Number(matchLC.rows[0].id);
        }
      } catch (e) {
        console.warn('Error verificando LC existente:', e.message);
      }

      // 5. Insertar cabecera en movimientos
      const headerRes = await db.execute({
        sql: `INSERT INTO movimientos 
              (tipo, subtipo, fecha, numero_documento, numero_factura_numerico, nro_control,
               usuario_responsable, documento_afectado, tasa_bcv, fecha_tasa_bcv,
               moneda_operacion, metodo_valoracion, proveedor_id, observaciones,
               estatus_conciliacion, libro_compras_id)
              VALUES ('ENTRADA_COMPRA', 'COMPRA_EXTEMPORANEA_INVENTARIO', ?, ?, ?, ?,
                      'CONTADOR_DG67', '', ?, ?,
                      'USD', 'CPP', ?, ?,
                      ?, ?)
              RETURNING id`,
        args: [
          fecha, cleanFact, numFacturaNum, cleanCtrl,
          tasaOp, fecha,
          provId,
          observaciones || `Entrada física a inventario (Factura fuera de período fiscal ${fecha} - Sin afectación al Libro de Compras)`,
          lcId ? 'CONCILIADO' : 'SOLO_INVENTARIO_EXTEMPORANEO',
          lcId
        ]
      });

      const movId = Number(headerRes.rows[0]?.id || headerRes.lastInsertRowid);

      // Si existía un registro en libro_compras huérfano sin conciliar, lo vinculamos
      if (lcId) {
        try {
          await db.execute({
            sql: `UPDATE libro_compras 
                  SET movimiento_id = ?, estatus_conciliacion = 'CONCILIADO', 
                      observaciones_cruce = 'Conciliado con entrada física de almacén #' || ?
                  WHERE id = ?`,
            args: [movId, movId, lcId]
          });
        } catch (e) {
          console.warn('Error vinculando LC con nuevo movimiento:', e.message);
        }
      }

      // 6. Insertar renglones de inventario
      if (Array.isArray(items) && items.length > 0) {
        const statements = items.map(it => {
          const pid = parseInt(it.producto_id, 10);
          const qty = parseFloat(it.cantidad) || 1;
          const cBs = parseFloat(it.costo_unitario_bs || (baseBs / qty));
          const cDiv = parseFloat(it.costo_unitario_divisa || (cBs / tasaOp));
          return {
            sql: `INSERT INTO movimiento_detalles (
                    movimiento_id, producto_id, cantidad,
                    costo_unitario_usd, costo_unitario_ves,
                    costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs,
                    precio_unitario_bs, precio_unitario_divisa,
                    base_imponible_bs, base_imponible_divisa,
                    monto_iva_bs, monto_iva_divisa,
                    total_linea_bs, total_linea_divisa
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              movId, pid, qty,
              cDiv, cBs,
              cDiv, tasaOp, cBs,
              cBs, cDiv,
              cBs * qty, cDiv * qty,
              (cBs * qty) * 0.16, (cDiv * qty) * 0.16,
              (cBs * qty) * 1.16, (cDiv * qty) * 1.16
            ]
          };
        });
        await db.batch(statements);
      } else {
        // Buscar o crear producto representativo para la mercancía del proveedor
        let prodCode = `MERC-${cleanRif.replace(/[^A-Z0-9]/g, '').slice(0, 8)}-${cleanFact.replace(/[^A-Z0-9]/g, '').slice(-6)}`;
        let prodDesc = `MERCANCÍA / REPUESTOS - ${cleanRazon.slice(0, 30)} (FACT. ${cleanFact})`;
        
        let prodRes = await db.execute({
          sql: "SELECT id FROM productos WHERE codigo = ? OR descripcion LIKE ? LIMIT 1",
          args: [prodCode, `%${cleanFact}%`]
        });
        let prodId = prodRes.rows[0]?.id || null;
        if (!prodId) {
          const newProd = await db.execute({
            sql: `INSERT INTO productos (codigo, descripcion, unidad_medida, categoria_id, almacen_id, stock_minimo, costo_referencial_usd, activo)
                  VALUES (?, ?, 'UND', 16, 1, 1.0, ?, 1) RETURNING id`,
            args: [prodCode, prodDesc, baseDiv]
          });
          prodId = Number(newProd.rows[0]?.id || newProd.lastInsertRowid);
        }

        await db.execute({
          sql: `INSERT INTO movimiento_detalles (
                  movimiento_id, producto_id, cantidad,
                  costo_unitario_usd, costo_unitario_ves,
                  costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs,
                  precio_unitario_bs, precio_unitario_divisa,
                  base_imponible_bs, base_imponible_divisa,
                  monto_iva_bs, monto_iva_divisa,
                  total_linea_bs, total_linea_divisa
                ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            movId, prodId,
            baseDiv, baseBs,
            baseDiv, tasaOp, baseBs,
            baseBs, baseDiv,
            baseBs, baseDiv,
            ivaBs, Number((ivaBs / tasaOp).toFixed(2)),
            totBs, totDiv
          ]
        });
      }

      return jsonResponse({
        success: true,
        movimientoId: movId,
        libro_compras_vinculado: lcId,
        message: `Factura [${cleanFact}] registrada exitosamente en Almacén / Inventario (Sin afectación al Libro de Compras ni alteración fiscal)`,
        estatus_conciliacion: lcId ? 'CONCILIADO' : 'SOLO_INVENTARIO_EXTEMPORANEO'
      });
    }

    if (path === '/api/fiscal/libro-compras' && method === 'POST') {
      const body = await request.json();
      const {
        periodo, fecha, rif, razon_social, nro_factura, nro_control,
        tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs,
        aplica_inventario, tipo_servicio, tasa_bcv, fecha_tasa_bcv
      } = body;

      if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
        return jsonResponse({ error: 'Faltan campos obligatorios para el Libro de Compras' }, 400);
      }
      if (await isPeriodoDeclarado(periodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite registrar compras en un período cerrado.`
        }, 403);
      }

      const cleanRif = String(rif).trim().toUpperCase();
      if (!isRifValidoFormato(cleanRif)) {
        return jsonResponse({ error: 'Formato de RIF inválido. Ejemplo válido: J-12345678-9 o V-12345678-0.' }, 400);
      }
      const cleanRazon = String(razon_social).trim();

      // VALIDACIÓN ESTRICTA ANTI-DUPLICADOS FISCALES (SENIAT Art. 75-76 RLIVA)
      const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, null, db);
      if (checkDup.duplicado) {
        return jsonResponse({
          error: checkDup.mensaje,
          duplicado: true,
          tipo: checkDup.tipo,
          factura_existente: checkDup.factura
        }, 409);
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;

      const ali = parseAlicuotaDecimal(alicuota, 0.16);
      const baseBs = Number(base_imponible_bs) || 0.0;
      const ivaBs = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
      const totBs = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaBs).toFixed(2));
      const baseDiv = Number((baseBs / tasaOp).toFixed(2));
      const ivaDiv = Number((ivaBs / tasaOp).toFixed(2));
      const totDiv = Number((totBs / tasaOp).toFixed(2));
      const esMercancia = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1');

      const provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE rif = ? LIMIT 1", args: [cleanRif] });
      let provId = provRes.rows[0]?.id || null;
      if (!provId) {
        try {
          const newProv = await db.execute({
            sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
                  VALUES (?, ?, ?, ?, 0.0) RETURNING id`,
            args: [cleanRif, cleanRazon, tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'), esMercancia ? 1 : 0]
          });
          provId = Number(newProv.rows[0]?.id || newProv.lastInsertRowid);
        } catch (e) {
          console.warn('Error auto-creando proveedor en Cloudflare:', e.message);
        }
      }

      // Nro de Operación correlativo
      const countRes = await db.execute({
        sql: `SELECT COALESCE(MAX(nro_operacion), 0) + 1 as next_op FROM libro_compras WHERE periodo = ?`,
        args: [periodo]
      });
      const nextOp = Number(countRes.rows[0]?.next_op || 1);

      let matchMovId = body.movimiento_id ? Number(body.movimiento_id) : null;
      let estatus = esMercancia ? (matchMovId ? 'CONCILIADO' : 'PENDIENTE_DG67') : 'NO_APLICA_GASTO';
      let obs = body.observaciones_cruce || (esMercancia ? (matchMovId ? `Cruzado con Entrada #${matchMovId}` : 'Declarada en SENIAT. Pendiente por recibir físicamente en almacén.') : 'Gasto operativo / servicio.');

      if (esMercancia && !matchMovId) {
        const numInt = normalizeFactNum(nro_factura);
        if (numInt || nro_factura) {
          try {
            const matchMov = await db.execute({
              sql: `SELECT m.id FROM movimientos m
                    JOIN proveedores pr ON m.proveedor_id = pr.id
                    WHERE m.tipo = 'ENTRADA_COMPRA' 
                      AND (m.libro_compras_id IS NULL OR m.libro_compras_id = 0)
                      AND UPPER(REPLACE(REPLACE(REPLACE(pr.rif, '-', ''), '.', ''), ' ', '')) = UPPER(REPLACE(REPLACE(REPLACE(?, '-', ''), '.', ''), ' ', ''))
                      AND (
                        (m.numero_factura_numerico IS NOT NULL AND m.numero_factura_numerico = ?)
                        OR UPPER(TRIM(m.numero_documento)) = UPPER(TRIM(?))
                        OR m.numero_documento LIKE ?
                      )
                    LIMIT 1`,
              args: [cleanRif, numInt || -1, nro_factura, `%${nro_factura}%`]
            });
            if (matchMov.rows.length > 0) {
              matchMovId = matchMov.rows[0].id;
              estatus = 'CONCILIADO';
              obs = `Conciliada automáticamente con recepción física en almacén #${matchMovId}.`;
            }
          } catch (e) {
            console.warn('Error en cruce automático Cloudflare:', e.message);
          }
        }
      }

      const retBs = body.iva_retenido_bs !== undefined && body.iva_retenido_bs !== null && body.iva_retenido_bs !== ''
        ? Number(body.iva_retenido_bs)
        : 0.0;
      const retDiv = Number((retBs / tasaOp).toFixed(2));

      const insResult = await db.execute({
        sql: `INSERT INTO libro_compras 
              (periodo, archivo_origen, nro_operacion, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
               tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs,
               iva_retenido_bs, iva_retenido_divisa,
               proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, movimiento_id, observaciones_cruce,
               tasa_bcv, fecha_tasa_bcv, moneda_divisa, base_imponible_divisa, monto_iva_divisa, total_divisa)
              VALUES 
              (?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?,
               ?, ?, ?, ?, ?, ?,
               ?, ?, 'USD', ?, ?, ?)
              RETURNING id`,
        args: [
          periodo, body.archivo_origen || 'SISTEMA_WEB', nextOp, fecha, body.fecha_recepcion || fecha, cleanRif, cleanRazon, String(nro_factura).trim(), nro_control || '00-000000',
          tipo_transaccion || '01-reg', baseBs, ali, ivaBs, totBs,
          retBs, retDiv,
          provId, tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'),
          esMercancia ? 1 : 0, estatus, matchMovId, obs,
          tasaOp, fechaTasaOp, baseDiv, ivaDiv, totDiv
        ]
      });

      const lcId = Number(insResult.rows[0]?.id || insResult.lastInsertRowid);

      if (matchMovId) {
        await db.execute({
          sql: "UPDATE movimientos SET libro_compras_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?",
          args: [lcId, matchMovId]
        }).catch(() => {});
      }
      await recalculateDeclaracionIva(periodo, db);

      return jsonResponse({
        success: true,
        id: lcId,
        nro_operacion: nextOp,
        message: 'Factura registrada con éxito en Libro de Compras (Doble Vía)',
        estatus_conciliacion: estatus,
        movimiento_id: matchMovId
      });
    }

    if (path === '/api/fiscal/libro-compras/batch' && method === 'POST') {
      const body = await request.json();
      const facturas = Array.isArray(body.facturas) ? body.facturas : [];
      if (facturas.length === 0) {
        return jsonResponse({ error: 'Se requiere una lista de facturas a asentar.' }, 400);
      }

      const resultados = [];
      let insertadas = 0;
      let duplicadas = 0;
      let errores = 0;
      const periodosAfectados = new Set();

      for (const f of facturas) {
        try {
          const { periodo, fecha, rif, razon_social, nro_factura, nro_control } = f;
          if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
            resultados.push({ nro_factura: nro_factura || 'S/N', rif: rif || '', success: false, error: 'Faltan campos obligatorios' });
            errores++;
            continue;
          }

          if (await isPeriodoDeclarado(periodo, db)) {
            resultados.push({ nro_factura, rif, success: false, error: `Período ${periodo} ya declarado y cerrado` });
            errores++;
            continue;
          }

          const cleanRif = String(rif).trim().toUpperCase();
          const cleanRazon = String(razon_social).trim();

          const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, null, db);
          if (checkDup.duplicado) {
            resultados.push({ nro_factura, rif: cleanRif, success: false, duplicado: true, error: checkDup.mensaje });
            duplicadas++;
            continue;
          }

          const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
          const tasaOp = Number(f.tasa_bcv) > 0 ? Number(f.tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
          const fechaTasaOp = f.fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;

          const ali = parseAlicuotaDecimal(f.alicuota, 0.16);
          const baseBs = Number(f.base_imponible_bs) || 0.0;
          const ivaBs = (f.iva_bs !== undefined && f.iva_bs !== null && f.iva_bs !== '') ? Number(f.iva_bs) : Number((baseBs * ali).toFixed(2));
          const totBs = (f.total_bs !== undefined && f.total_bs !== null && f.total_bs !== '') ? Number(f.total_bs) : Number((baseBs + ivaBs).toFixed(2));
          const baseDiv = Number((baseBs / tasaOp).toFixed(2));
          const ivaDiv = Number((ivaBs / tasaOp).toFixed(2));
          const totDiv = Number((totBs / tasaOp).toFixed(2));
          const esMercancia = (f.aplica_inventario === 1 || f.aplica_inventario === true || f.aplica_inventario === '1');

          const provRes = await db.execute({
            sql: "SELECT id FROM proveedores WHERE UPPER(REPLACE(REPLACE(rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', '')) LIMIT 1",
            args: [cleanRif]
          });
          let provId = provRes.rows[0]?.id || null;
          if (!provId) {
            try {
              const newProv = await db.execute({
                sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
                      VALUES (?, ?, ?, ?, 0.0) RETURNING id`,
                args: [cleanRif, cleanRazon, f.tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'), esMercancia ? 1 : 0]
              });
              provId = Number(newProv.rows[0]?.id || newProv.lastInsertRowid);
            } catch (e) { }
          }

          const countRes = await db.execute({
            sql: `SELECT COALESCE(MAX(nro_operacion), 0) + 1 as next_op FROM libro_compras WHERE periodo = ?`,
            args: [periodo]
          });
          const nextOp = Number(countRes.rows[0]?.next_op || 1);

          let estatus = esMercancia ? 'PENDIENTE_DG67' : 'NO_APLICA_GASTO';
          let obs = f.observaciones_cruce || (esMercancia ? 'Factura asentada por Carga Masiva PDF. Pendiente por recepción física.' : 'Gasto operativo / servicio asentado por Carga Masiva PDF.');

          const retBs = f.iva_retenido_bs !== undefined && f.iva_retenido_bs !== null && f.iva_retenido_bs !== ''
            ? Number(f.iva_retenido_bs)
            : 0.0;
          const retDiv = Number((retBs / tasaOp).toFixed(2));

          const insResult = await db.execute({
            sql: `INSERT INTO libro_compras 
                  (periodo, archivo_origen, nro_operacion, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
                   tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs,
                   iva_retenido_bs, iva_retenido_divisa,
                   proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, movimiento_id, observaciones_cruce,
                   tasa_bcv, fecha_tasa_bcv, moneda_divisa, base_imponible_divisa, monto_iva_divisa, total_divisa)
                  VALUES 
                  (?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?,
                   ?, ?,
                   ?, ?, ?, ?, ?, ?,
                   ?, ?, 'USD', ?, ?, ?)
                  RETURNING id`,
            args: [
              periodo, f.archivo_origen || 'CARGA_MASIVA_PDF', nextOp, fecha, f.fecha_recepcion || fecha, cleanRif, cleanRazon, String(nro_factura).trim(), nro_control || '00-000000',
              f.tipo_transaccion || '01-reg', baseBs, ali, ivaBs, totBs,
              retBs, retDiv,
              provId, f.tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'),
              esMercancia ? 1 : 0, estatus, null, obs,
              tasaOp, fechaTasaOp, baseDiv, ivaDiv, totDiv
            ]
          });

          const lcId = Number(insResult.rows[0]?.id || insResult.lastInsertRowid);
          insertadas++;
          periodosAfectados.add(periodo);
          resultados.push({
            id: lcId,
            nro_factura,
            rif: cleanRif,
            nro_operacion: nextOp,
            success: true,
            mensaje: `Factura ${nro_factura} asentada con éxito (Op #${nextOp})`
          });
        } catch (err) {
          errores++;
          resultados.push({ nro_factura: f.nro_factura || 'S/N', rif: f.rif || '', success: false, error: err.message });
        }
      }

      for (const per of periodosAfectados) {
        await recalculateDeclaracionIva(per, db);
      }

      return jsonResponse({
        success: true,
        total_procesadas: facturas.length,
        insertadas,
        duplicadas,
        errores,
        resultados
      });
    }

    if (path.startsWith('/api/fiscal/libro-compras/') && method === 'GET') {
      const compId = parseInt(path.split('/').pop(), 10);
      const res = await db.execute({ sql: "SELECT * FROM libro_compras WHERE id = ?", args: [compId] });
      if (res.rows.length === 0) {
        return jsonResponse({ error: 'Factura de compra no encontrada' }, 404);
      }
      return jsonResponse(res.rows[0]);
    }

    if (path.startsWith('/api/fiscal/libro-compras/') && method === 'PUT') {
      const compId = parseInt(path.split('/').pop(), 10);
      const existingC = await db.execute({ sql: "SELECT periodo, movimiento_id FROM libro_compras WHERE id = ?", args: [compId] });
      if (existingC.rows.length === 0) {
        return jsonResponse({ error: 'Factura de compra no encontrada' }, 404);
      }
      const oldRow = existingC.rows[0];
      const body = await request.json();
      const targetPeriodo = body.periodo || oldRow.periodo;
      if ((await isPeriodoDeclarado(oldRow.periodo, db)) || (await isPeriodoDeclarado(targetPeriodo, db))) {
        return jsonResponse({
          error: `El período fiscal ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
        }, 403);
      }

      const {
        periodo, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
        tipo_transaccion, base_imponible_bs, base_imponible_divisa,
        alicuota, iva_bs, monto_iva_divisa, total_bs, total_divisa,
        iva_retenido_bs, iva_retenido_divisa, tasa_bcv, fecha_tasa_bcv, moneda_divisa,
        tipo_servicio, aplica_inventario, observaciones_cruce,
        movimiento_id
      } = body;

      if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
        return jsonResponse({ error: 'Faltan campos obligatorios (Período, Fecha, RIF, Razón Social o N° Factura).' }, 400);
      }

      const cleanRif = String(rif).trim().toUpperCase();
      if (!isRifValidoFormato(cleanRif)) {
        return jsonResponse({ error: 'Formato de RIF inválido. Ejemplo válido: J-12345678-9 o V-12345678-0.' }, 400);
      }
      const cleanRazon = String(razon_social).trim();

      const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, compId, db);
      if (checkDup.duplicado) {
        return jsonResponse({
          error: checkDup.mensaje,
          duplicado: true,
          tipo: checkDup.tipo,
          factura_existente: checkDup.factura
        }, 409);
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;

      const ali = parseAlicuotaDecimal(alicuota, 0.16);
      let baseBs = Number(base_imponible_bs) || 0.0;
      let baseDiv = Number(base_imponible_divisa) || 0.0;
      if (baseBs <= 0 && baseDiv > 0) baseBs = Number((baseDiv * tasaOp).toFixed(2));
      else if (baseDiv <= 0 && baseBs > 0) baseDiv = Number((baseBs / tasaOp).toFixed(2));

      const ivaBsCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
      const ivaDivCalc = (monto_iva_divisa !== undefined && monto_iva_divisa !== null && monto_iva_divisa !== '') ? Number(monto_iva_divisa) : Number((ivaBsCalc / tasaOp).toFixed(2));
      const totBsCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaBsCalc).toFixed(2));
      const totDivCalc = (total_divisa !== undefined && total_divisa !== null && total_divisa !== '') ? Number(total_divisa) : Number((totBsCalc / tasaOp).toFixed(2));
      const retBs = Number(iva_retenido_bs) || 0.0;
      const retDiv = (iva_retenido_divisa !== undefined && iva_retenido_divisa !== null && iva_retenido_divisa !== '') ? Number(iva_retenido_divisa) : Number((retBs / tasaOp).toFixed(2));

      const esMercancia = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1');
      const movIdInt = movimiento_id ? Number(movimiento_id) : null;
      const estatus = esMercancia ? (movIdInt ? 'CONCILIADO' : 'PENDIENTE_DG67') : 'NO_APLICA_GASTO';
      const obs = observaciones_cruce || (esMercancia ? (movIdInt ? `Cruzado con Entrada #${movIdInt}` : 'Pendiente en almacén') : 'Gasto operativo / servicio.');

      const provRes = await db.execute({
        sql: "SELECT id FROM proveedores WHERE UPPER(REPLACE(REPLACE(rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', '')) LIMIT 1",
        args: [cleanRif]
      });
      let provId = provRes.rows[0]?.id || null;
      if (!provId) {
        try {
          const newProv = await db.execute({
            sql: "INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion) VALUES (?, ?, ?, ?, 0.0) RETURNING id",
            args: [cleanRif, cleanRazon, tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'), esMercancia ? 1 : 0]
          });
          provId = Number(newProv.rows[0]?.id || newProv.lastInsertRowid);
        } catch (e) { }
      }

      await db.execute({
        sql: `UPDATE libro_compras SET
                periodo = ?, fecha = ?, fecha_recepcion = ?, rif = ?, razon_social = ?,
                nro_factura = ?, nro_control = ?, tipo_transaccion = ?, base_imponible_bs = ?,
                alicuota = ?, iva_bs = ?, total_bs = ?, iva_retenido_bs = ?,
                tasa_bcv = ?, fecha_tasa_bcv = ?, moneda_divisa = ?, base_imponible_divisa = ?,
                monto_iva_divisa = ?, total_divisa = ?, iva_retenido_divisa = ?,
                proveedor_id = ?, tipo_servicio = ?, aplica_inventario = ?,
                estatus_conciliacion = ?, movimiento_id = ?, observaciones_cruce = ?
              WHERE id = ?`,
        args: [
          periodo, fecha, fecha_recepcion || fecha, cleanRif, cleanRazon,
          nro_factura, nro_control || '00-000000', tipo_transaccion || '01-reg', baseBs,
          ali, ivaBsCalc, totBsCalc, retBs,
          tasaOp, fechaTasaOp, moneda_divisa || 'USD', baseDiv,
          ivaDivCalc, totDivCalc, retDiv,
          provId, tipo_servicio || (esMercancia ? 'MERCANCIA_REPUESTOS' : 'SERVICIOS_CONTABLES_Y_LEGALES'),
          esMercancia ? 1 : 0, estatus, movIdInt, obs,
          compId
        ]
      });

      if (oldRow.movimiento_id && Number(oldRow.movimiento_id) !== Number(movIdInt)) {
        await db.execute({
          sql: "UPDATE movimientos SET libro_compras_id = NULL, estatus_conciliacion = 'NO_CONCILIADO' WHERE id = ? AND libro_compras_id = ?",
          args: [oldRow.movimiento_id, compId]
        }).catch(() => {});
      }

      if (movIdInt) {
        await db.execute({
          sql: "UPDATE movimientos SET libro_compras_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?",
          args: [compId, movIdInt]
        }).catch(() => {});
      }
      await recalculateDeclaracionIva(periodo, db);
      if (oldRow.periodo && oldRow.periodo !== periodo) await recalculateDeclaracionIva(oldRow.periodo, db);

      return jsonResponse({
        success: true,
        id: compId,
        message: 'Factura actualizada con éxito en Libro de Compras (Bs. y $ USD).'
      });
    }

    if (path.startsWith('/api/fiscal/libro-compras/') && method === 'DELETE') {
      const compId = parseInt(path.split('/').pop(), 10);
      const existingC = await db.execute({ sql: "SELECT periodo FROM libro_compras WHERE id = ?", args: [compId] });
      const targetPeriodo = existingC.rows[0]?.periodo;
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite eliminar facturas de un período cerrado.`
        }, 403);
      }
      await db.execute({ sql: "UPDATE movimientos SET libro_compras_id = NULL, estatus_conciliacion = 'NO_CONCILIADO' WHERE libro_compras_id = ?", args: [compId] }).catch(() => {});
      await db.execute({ sql: "DELETE FROM libro_compras WHERE id = ?", args: [compId] });
      await recalculateDeclaracionIva(targetPeriodo, db);
      return jsonResponse({ success: true, message: 'Factura eliminada del Libro de Compras.' });
    }

    // CONSULTA DINÁMICA DE DETALLE DE DECLARACIÓN IVA (SENIAT FORMA 30) POR PERÍODO
    if (path.startsWith('/api/fiscal/declaracion/') && method === 'GET') {
      const parts = path.split('/');
      const periodo = parts[4] || '2026-10';

      const [ventasRes, comprasRes, declPrev, declActualRes] = await Promise.all([
        db.execute({
          sql: `SELECT 
                  COALESCE(SUM(base_imponible_bs), 0) as total_base,
                  COALESCE(SUM(iva_bs), 0) as total_iva,
                  COALESCE(SUM(exento_bs), 0) as total_exento,
                  COUNT(DISTINCT fecha) as count_lotes
                FROM libro_ventas WHERE periodo = ?`,
          args: [periodo]
        }),
        db.execute({
          sql: `SELECT 
                  COALESCE(SUM(base_imponible_bs), 0) as total_base,
                  COALESCE(SUM(iva_bs), 0) as total_iva,
                  COALESCE(SUM(iva_retenido_bs), 0) as total_retenido,
                  COUNT(*) as count_facturas
                FROM libro_compras WHERE periodo = ?`,
          args: [periodo]
        }),
        db.execute({
          sql: `SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1`,
          args: [periodo]
        }),
        db.execute({
          sql: `SELECT * FROM declaraciones_iva WHERE periodo = ? LIMIT 1`,
          args: [periodo]
        })
      ]);

      const declRow = declActualRes.rows[0] || null;
      const isDeclarado = declRow?.estatus === 'DECLARADO';

      const vBase = Number(ventasRes.rows[0]?.total_base || 0);
      const vDeb = Number(ventasRes.rows[0]?.total_iva || 0);
      const vExento = Number(ventasRes.rows[0]?.total_exento || 0);
      const vDias = Number(ventasRes.rows[0]?.count_lotes || 0);

      const cBase = Number(comprasRes.rows[0]?.total_base || 0);
      const cCred = Number(comprasRes.rows[0]?.total_iva || 0);
      const cRet = Number(comprasRes.rows[0]?.total_retenido || 0);
      const cFacs = Number(comprasRes.rows[0]?.count_facturas || 0);

      const excAnt = Number(declPrev.rows[0]?.excedente_siguiente_bs || 0);
      const totCred = Number((cCred + excAnt).toFixed(2));
      const saldo = Number((vDeb - totCred).toFixed(2));
      const aPagar = saldo > 0 ? saldo : 0;
      const excSig = saldo < 0 ? Math.abs(saldo) : 0;

      const declaracion = {
        periodo,
        ventas_base_bs: isDeclarado && Number(declRow.ventas_base_bs) > 0 ? Number(declRow.ventas_base_bs) : vBase,
        debito_fiscal_bs: isDeclarado && Number(declRow.debito_fiscal_bs) > 0 ? Number(declRow.debito_fiscal_bs) : vDeb,
        compras_base_bs: isDeclarado && Number(declRow.compras_base_bs) > 0 ? Number(declRow.compras_base_bs) : cBase,
        credito_fiscal_bs: isDeclarado && Number(declRow.credito_fiscal_bs) > 0 ? Number(declRow.credito_fiscal_bs) : cCred,
        iva_retenido_bs: 0,
        iva_retenido_compras_bs: cRet,
        excedente_anterior_bs: excAnt,
        excedente_siguiente_bs: isDeclarado && declRow.excedente_siguiente_bs !== undefined ? Number(declRow.excedente_siguiente_bs) : excSig,
        total_a_pagar_bs: isDeclarado && declRow.total_a_pagar_bs !== undefined ? Number(declRow.total_a_pagar_bs) : aPagar,
        total_compras_facturas: isDeclarado && Number(declRow.total_compras_facturas) > 0 ? Number(declRow.total_compras_facturas) : cFacs,
        total_ventas_dias: isDeclarado && Number(declRow.total_ventas_dias) > 0 ? Number(declRow.total_ventas_dias) : vDias,
        estatus: declRow?.estatus || (periodo <= '2026-09' ? 'DECLARADO' : 'EN_PROCESO')
      };

      return jsonResponse({
        declaracion,
        ventas: {
          total_base: vBase,
          total_iva: vDeb,
          total_exento: vExento,
          count_lotes: vDias
        },
        compras: {
          total_base: cBase,
          total_iva: cCred,
          total_retenido: cRet,
          count_facturas: cFacs
        }
      });
    }

    // CIERRE Y CAMBIO DE ESTATUS DE DECLARACIÓN IVA (SENIAT FORMA 30)
    if (path.startsWith('/api/fiscal/declaraciones/') && path.endsWith('/estatus') && (method === 'PUT' || method === 'POST')) {
      const parts = path.split('/');
      // /api/fiscal/declaraciones/:periodo/estatus -> parts[4]
      const periodo = parts[4];
      const body = await request.json();
      const nuevoEstatus = String(body?.estatus || 'DECLARADO').toUpperCase();

      if (!['DECLARADO', 'EN_PROCESO'].includes(nuevoEstatus)) {
        return jsonResponse({ error: 'Estatus inválido. Debe ser DECLARADO o EN_PROCESO' }, 400);
      }

      // Consolidar totales exactos del período desde los Libros
      const [ventasRes, comprasRes, declPrev] = await Promise.all([
        db.execute({
          sql: `SELECT 
                  COALESCE(SUM(base_imponible_bs), 0) as ventas_base,
                  COALESCE(SUM(iva_bs), 0) as debito_fiscal,
                  COUNT(DISTINCT fecha) as dias_ventas
                FROM libro_ventas WHERE periodo = ?`,
          args: [periodo]
        }),
        db.execute({
          sql: `SELECT 
                  COALESCE(SUM(base_imponible_bs), 0) as compras_base,
                  COALESCE(SUM(iva_bs), 0) as credito_fiscal,
                  COALESCE(SUM(iva_retenido_bs), 0) as iva_retenido,
                  COUNT(*) as total_facturas
                FROM libro_compras WHERE periodo = ?`,
          args: [periodo]
        }),
        db.execute({
          sql: `SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1`,
          args: [periodo]
        })
      ]);

      const vBase = Number(ventasRes.rows[0]?.ventas_base || 0);
      const vDeb = Number(ventasRes.rows[0]?.debito_fiscal || 0);
      const cBase = Number(comprasRes.rows[0]?.compras_base || 0);
      const cCred = Number(comprasRes.rows[0]?.credito_fiscal || 0);
      const cRet = Number(comprasRes.rows[0]?.iva_retenido || 0);
      const totalFac = Number(comprasRes.rows[0]?.total_facturas || 0);
      const totalDias = Number(ventasRes.rows[0]?.dias_ventas || 0);

      const excAnt = Number(declPrev.rows[0]?.excedente_siguiente_bs || 0);
      const totCred = Number((cCred + excAnt).toFixed(2));
      const saldo = Number((vDeb - totCred).toFixed(2));
      const aPagar = saldo > 0 ? saldo : 0;
      const excSig = saldo < 0 ? Math.abs(saldo) : 0;

      await db.execute({
        sql: `INSERT INTO declaraciones_iva (
                periodo, estatus, ventas_base_bs, debito_fiscal_bs, compras_base_bs,
                credito_fiscal_bs, iva_retenido_bs, excedente_anterior_bs, excedente_siguiente_bs,
                total_a_pagar_bs, total_compras_facturas, total_ventas_dias
              ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
              ON CONFLICT(periodo) DO UPDATE SET
                estatus = excluded.estatus,
                ventas_base_bs = excluded.ventas_base_bs,
                debito_fiscal_bs = excluded.debito_fiscal_bs,
                compras_base_bs = excluded.compras_base_bs,
                credito_fiscal_bs = excluded.credito_fiscal_bs,
                iva_retenido_bs = 0,
                excedente_anterior_bs = excluded.excedente_anterior_bs,
                excedente_siguiente_bs = excluded.excedente_siguiente_bs,
                total_a_pagar_bs = excluded.total_a_pagar_bs,
                total_compras_facturas = excluded.total_compras_facturas,
                total_ventas_dias = excluded.total_ventas_dias`,
        args: [
          periodo, nuevoEstatus, vBase, vDeb, cBase, cCred,
          excAnt, excSig, aPagar, totalFac, totalDias
        ]
      });

      return jsonResponse({
        success: true,
        periodo,
        estatus: nuevoEstatus,
        mensaje: nuevoEstatus === 'DECLARADO'
          ? `Período ${periodo} declarado y cerrado ante el SENIAT. Libros bloqueados en modo consulta.`
          : `Período ${periodo} reabierto para ajustes.`
      });
    }

    if (path === '/api/fiscal/declaraciones-iva' && method === 'GET') {
      const res = await db.execute("SELECT * FROM declaraciones_iva ORDER BY periodo ASC");
      const rows = res.rows.map(r => ({ ...r }));

      // Autocalcular dinámicamente cualquier período en preparación
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.estatus === 'EN_PROCESO') {
          const [vRes, cRes, prevRes] = await Promise.all([
            db.execute({
              sql: `SELECT COALESCE(SUM(base_imponible_bs), 0) as v_base, COALESCE(SUM(iva_bs), 0) as v_deb, COUNT(DISTINCT fecha) as v_dias FROM libro_ventas WHERE periodo = ?`,
              args: [row.periodo]
            }),
            db.execute({
              sql: `SELECT COALESCE(SUM(base_imponible_bs), 0) as c_base, COALESCE(SUM(iva_bs), 0) as c_cred, COUNT(*) as c_facs FROM libro_compras WHERE periodo = ?`,
              args: [row.periodo]
            }),
            db.execute({
              sql: `SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1`,
              args: [row.periodo]
            })
          ]);

          const vBase = Number(vRes.rows[0]?.v_base || 0);
          const vDeb = Number(vRes.rows[0]?.v_deb || 0);
          const vDias = Number(vRes.rows[0]?.v_dias || 0);

          const cBase = Number(cRes.rows[0]?.c_base || 0);
          const cCred = Number(cRes.rows[0]?.c_cred || 0);
          const cFacs = Number(cRes.rows[0]?.c_facs || 0);

          const excAnt = Number(prevRes.rows[0]?.excedente_siguiente_bs || 0);
          const totCred = Number((cCred + excAnt).toFixed(2));
          const saldo = Number((vDeb - totCred).toFixed(2));
          const aPagar = saldo > 0 ? saldo : 0;
          const excSig = saldo < 0 ? Math.abs(saldo) : 0;

          row.ventas_base_bs = vBase;
          row.debito_fiscal_bs = vDeb;
          row.compras_base_bs = cBase;
          row.credito_fiscal_bs = cCred;
          row.excedente_anterior_bs = excAnt;
          row.excedente_siguiente_bs = excSig;
          row.total_a_pagar_bs = aPagar;
          row.total_compras_facturas = cFacs;
          row.total_ventas_dias = vDias;
        }
      }

      return jsonResponse(rows);
    }

    if (path === '/api/fiscal/resumen-cruce' && method === 'GET') {
      const [declaraciones, comprasStats, inventarioStats] = await Promise.all([
        db.execute("SELECT * FROM declaraciones_iva ORDER BY periodo ASC"),
        db.execute(`
          SELECT 
            periodo,
            COUNT(*) as total_facturas_compras,
            SUM(CASE WHEN aplica_inventario = 1 THEN 1 ELSE 0 END) as facturas_mercancia,
            SUM(CASE WHEN aplica_inventario = 0 THEN 1 ELSE 0 END) as facturas_gastos,
            SUM(CASE WHEN estatus_conciliacion = 'CONCILIADO' THEN 1 ELSE 0 END) as facturas_cuadradas,
            SUM(CASE WHEN estatus_conciliacion = 'NO_CONCILIADO' AND aplica_inventario = 1 THEN 1 ELSE 0 END) as facturas_pendientes_inventario,
            SUM(base_imponible_bs) as total_base_compras_bs,
            SUM(CASE WHEN aplica_inventario = 1 THEN base_imponible_bs ELSE 0 END) as base_mercancia_bs,
            SUM(CASE WHEN aplica_inventario = 0 THEN base_imponible_bs ELSE 0 END) as base_gastos_bs
          FROM libro_compras
          GROUP BY periodo
          ORDER BY periodo ASC
        `),
        db.execute(`
          SELECT 
            strftime('%Y-%m', fecha) as periodo,
            COUNT(DISTINCT m.id) as total_entradas_inventario,
            SUM(d.cantidad) as total_unidades_ingresadas,
            SUM(d.cantidad * d.costo_unitario_usd) as total_costo_usd
          FROM movimientos m
          JOIN movimiento_detalles d ON m.id = d.movimiento_id
          WHERE m.tipo = 'ENTRADA_COMPRA'
          GROUP BY strftime('%Y-%m', fecha)
        `)
      ]);

      return jsonResponse({
        declaraciones: declaraciones.rows,
        compras: comprasStats.rows,
        inventario: inventarioStats.rows
      });
    }

    // ----------------------------------------------------
    // RETENCIONES ISLR (DECRETO 1808)
    // ----------------------------------------------------
    if (path === '/api/islr/config' && method === 'GET') {
      const [cfgRes, empRes] = await Promise.all([
        db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1"),
        db.execute("SELECT * FROM empresas WHERE id = 1")
      ]);
      const cfg = cfgRes.rows[0] || {};
      const emp = empRes.rows[0] || {};
      return jsonResponse({
        ...cfg,
        config: cfg,
        empresa: emp
      });
    }

    if (path === '/api/islr/conceptos' && method === 'GET') {
      return jsonResponse(CATALOGO_CONCEPTOS_ISLR);
    }

    if (path === '/api/islr/comprobantes' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const q = url.searchParams.get('q');
      let sql = `
        SELECT r.*,
               (SELECT COUNT(*) FROM retenciones_islr_detalles d WHERE d.retencion_id = r.id) as cantidad_items
        FROM retenciones_islr r
        WHERE 1=1
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND r.periodo = ?`;
        args.push(periodo);
      }
      if (q && q.trim() !== '') {
        const term = `%${q.trim()}%`;
        sql += ` AND (r.nro_comprobante LIKE ? OR r.sujeto_rif LIKE ? OR r.sujeto_razon_social LIKE ? OR EXISTS (SELECT 1 FROM retenciones_islr_detalles d WHERE d.retencion_id = r.id AND d.nro_factura LIKE ?))`;
        args.push(term, term, term, term);
      }
      sql += ` ORDER BY r.periodo DESC, r.id DESC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/islr/proximo-numero' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const libroCompraId = url.searchParams.get('libro_compra_id');
      const nroFactura = url.searchParams.get('nro_factura');
      const rif = url.searchParams.get('rif');

      if (libroCompraId || (nroFactura && rif)) {
        let existingRow = null;
        if (libroCompraId) {
          const r1 = await db.execute({
            sql: "SELECT ri.id, ri.nro_comprobante, ri.periodo FROM retenciones_islr ri JOIN retenciones_islr_detalles rid ON ri.id = rid.retencion_id WHERE rid.libro_compra_id = ? ORDER BY ri.id ASC LIMIT 1",
            args: [libroCompraId]
          }).catch(() => ({ rows: [] }));
          if (r1.rows.length > 0) existingRow = r1.rows[0];
        }
        if (!existingRow && nroFactura && rif) {
          const r2 = await db.execute({
            sql: "SELECT ri.id, ri.nro_comprobante, ri.periodo FROM retenciones_islr ri JOIN retenciones_islr_detalles rid ON ri.id = rid.retencion_id WHERE UPPER(TRIM(rid.nro_factura)) = UPPER(TRIM(?)) AND UPPER(REPLACE(REPLACE(ri.sujeto_rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', '')) ORDER BY ri.id ASC LIMIT 1",
            args: [nroFactura, rif]
          }).catch(() => ({ rows: [] }));
          if (r2.rows.length > 0) existingRow = r2.rows[0];
        }
        if (existingRow) {
          return jsonResponse({
            periodo: existingRow.periodo || periodo,
            nro_comprobante: existingRow.nro_comprobante,
            retencion_id: existingRow.id,
            es_existente: true
          });
        }
      }

      const yyyymm = String(periodo).replace('-', '').slice(0, 6);

      const [resPer, resGlobal] = await Promise.all([
        db.execute({
          sql: "SELECT nro_comprobante FROM retenciones_islr WHERE nro_comprobante LIKE ? ORDER BY CAST(SUBSTR(nro_comprobante, 7) AS INTEGER) DESC LIMIT 1",
          args: [`${yyyymm}%`]
        }),
        db.execute("SELECT nro_comprobante FROM retenciones_islr WHERE length(nro_comprobante) >= 14 ORDER BY CAST(SUBSTR(nro_comprobante, 7) AS INTEGER) DESC LIMIT 1")
      ]);

      let nextSeq = 1;
      if (resPer.rows.length > 0) {
        const last = String(resPer.rows[0].nro_comprobante);
        const numPart = parseInt(last.slice(6), 10) || 0;
        nextSeq = numPart + 1;
      } else if (resGlobal.rows.length > 0) {
        const lastGlobal = String(resGlobal.rows[0].nro_comprobante);
        const numPart = parseInt(lastGlobal.slice(6), 10) || 0;
        nextSeq = numPart + 1;
      }

      const nroComprobante = `${yyyymm}${String(nextSeq).padStart(8, '0')}`;
      return jsonResponse({ periodo, nro_comprobante: nroComprobante, es_existente: false });
    }

    if (path === '/api/islr/facturas-disponibles' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const rif = url.searchParams.get('rif');
      let sql = `
        SELECT 
          lc.*,
          p.id as prov_id,
          p.tipo_servicio as prov_tipo_servicio,
          COALESCE(p.tipo_persona, CASE WHEN lc.rif LIKE 'V%' OR lc.rif LIKE 'E%' THEN 'PN-R' ELSE 'PJ-D' END) as tipo_persona,
          COALESCE(p.direccion_fiscal, '') as direccion_fiscal,
          COALESCE(p.email, '') as email,
          COALESCE(p.telefono, '') as telefono,
          COALESCE(p.codigo_concepto_islr, '055') as codigo_concepto_islr,
          ri.nro_comprobante as comprobante_islr_emitido
        FROM libro_compras lc
        LEFT JOIN proveedores p ON UPPER(REPLACE(REPLACE(lc.rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(p.rif, '-', ''), ' ', ''))
        LEFT JOIN retenciones_islr_detalles rid ON rid.libro_compra_id = lc.id
        LEFT JOIN retenciones_islr ri ON ri.id = rid.retencion_id
        WHERE 1=1
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND lc.periodo = ?`;
        args.push(periodo);
      }
      if (rif) {
        sql += ` AND lc.rif = ?`;
        args.push(rif);
      }
      sql += ` GROUP BY lc.id ORDER BY lc.aplica_inventario ASC, lc.periodo DESC, lc.fecha DESC`;
      const result = await db.execute({ sql, args });
      const enriched = (result.rows || []).map(f => {
        const tipoSrv = f.tipo_servicio && !['MERCANCIA_REPUESTOS', 'ACTIVO_FIJO_EQUIPOS', 'GASTOS_OPERATIVOS_VARIOS'].includes(f.tipo_servicio)
          ? f.tipo_servicio
          : (f.prov_tipo_servicio || f.tipo_servicio || 'CONTRATISTAS_OBRAS_SERVICIOS');
        const resIslr = resolverConceptoISLR({
          tipoServicio: tipoSrv,
          rif: f.rif,
          tipoPersona: f.tipo_persona,
          codigoActual: f.codigo_concepto_islr
        });
        return {
          ...f,
          tipo_servicio_efectivo: resIslr.tipo_servicio,
          tipo_persona: resIslr.tipo_contribuyente,
          codigo_concepto_islr: resIslr.codigo_sugerido,
          pct_tarifa_sugerida: resIslr.concepto_sugerido.pct_tarifa,
          pct_base_sugerida: resIslr.concepto_sugerido.pct_base
        };
      });
      return jsonResponse(enriched);
    }

    if (path.startsWith('/api/islr/comprobantes/') && method === 'GET') {
      const id = path.split('/')[4];
      const [headerRes, itemsRes, configRes] = await Promise.all([
        db.execute({ sql: "SELECT * FROM retenciones_islr WHERE id = ?", args: [id] }),
        db.execute({ sql: "SELECT * FROM retenciones_islr_detalles WHERE retencion_id = ? ORDER BY nro_operacion ASC", args: [id] }),
        db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1")
      ]);

      if (headerRes.rows.length === 0) {
        return jsonResponse({ error: 'Comprobante de Retención ISLR no encontrado' }, 404);
      }

      const comp = headerRes.rows[0];
      // Si el comprobante tenía guardada una tasa obsoleta o irreal (ej. <= 100), corregir dinámicamente con la tasa oficial BCV de la factura o período
      if (!comp.tasa_bcv || Number(comp.tasa_bcv) <= 100) {
        let realTasa = null;
        if (itemsRes.rows.length > 0 && itemsRes.rows[0].libro_compra_id) {
          const lcRes = await db.execute({
            sql: "SELECT tasa_bcv FROM libro_compras WHERE id = ?",
            args: [itemsRes.rows[0].libro_compra_id]
          }).catch(() => ({ rows: [] }));
          if (lcRes.rows.length > 0 && Number(lcRes.rows[0].tasa_bcv) > 100) {
            realTasa = Number(lcRes.rows[0].tasa_bcv);
          }
        }
        if (!realTasa) {
          const tasaPerRes = await db.execute({
            sql: "SELECT tasa_bcv FROM tasas_bcv_periodo WHERE periodo = ?",
            args: [comp.periodo || '2026-10']
          }).catch(() => ({ rows: [] }));
          if (tasaPerRes.rows.length > 0 && Number(tasaPerRes.rows[0].tasa_bcv) > 100) {
            realTasa = Number(tasaPerRes.rows[0].tasa_bcv);
          }
        }
        if (!realTasa) realTasa = 880.12;

        comp.tasa_bcv = realTasa;
        await db.execute({
          sql: "UPDATE retenciones_islr SET tasa_bcv = ? WHERE id = ?",
          args: [realTasa, id]
        }).catch(() => {});
      }

      return jsonResponse({
        comprobante: comp,
        detalles: itemsRes.rows,
        config: configRes.rows[0] || {}
      });
    }

    if (path === '/api/islr/comprobantes' && method === 'POST') {
      const body = await request.json();
      const {
        nro_comprobante,
        periodo,
        fecha_emision,
        hora_emision,
        proveedor_id,
        sujeto_rif,
        sujeto_razon_social,
        sujeto_tipo_persona,
        sujeto_direccion,
        sujeto_email,
        sujeto_telefono,
        concepto_general,
        es_multimoneda,
        moneda_divisa,
        tasa_bcv,
        valor_ut_aplicado,
        observaciones,
        detalles
      } = body;

      const targetPeriodo = periodo || '2026-10';
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} se encuentra DECLARADO y CERRADO formalmente ante el SENIAT (Forma 30). Las retenciones de ISLR correspondientes a este mes están cerradas y no admiten nuevas emisiones ni modificaciones.`
        }, 403);
      }

      const cleanNroComp = String(nro_comprobante || '').trim();
      if (!/^\d{14}$/.test(cleanNroComp)) {
        return jsonResponse({
          error: 'El Número de Comprobante debe tener exactamente 14 dígitos numéricos (Formato AAAAMM + 8 dígitos secuenciales, ej. 20261000000001).'
        }, 400);
      }

      const cleanEmail = String(sujeto_email || '').trim();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return jsonResponse({
          error: 'El Correo Electrónico del Proveedor (Sujeto Retenido) es un CAMPO OBLIGATORIO según la Providencia Administrativa SNAT/2026/00093.'
        }, 400);
      }

      const cleanRif = String(sujeto_rif || '').trim().toUpperCase();
      if (!cleanRif || !sujeto_razon_social) {
        return jsonResponse({ error: 'El RIF y la Razón Social del Sujeto Retenido son obligatorios.' }, 400);
      }

      if (!Array.isArray(detalles) || detalles.length === 0) {
        return jsonResponse({ error: 'Debe incluir al menos una factura o documento objeto de retención.' }, 400);
      }

      const cfgRes = await db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1");
      const cfg = cfgRes.rows[0] || { valor_ut_bs: 43.00, factor_sustraendo: 83.3334 };
      const utBs = Number(valor_ut_aplicado || cfg.valor_ut_bs || 43.00);
      const factorSust = Number(cfg.factor_sustraendo || 83.3334);
      const tipoPersona = normalizarTipoContribuyente(cleanRif, sujeto_tipo_persona);

      let totDocBs = 0;
      let totBaseBs = 0;
      let totSustBs = 0;
      let totRetBs = 0;
      let codigoPrincipal = '055';

      const processedItems = detalles.map((item, idx) => {
        const montoDoc = Number(item.monto_total_bs || 0);
        const baseImp = Number(item.base_imponible_bs || 0);
        const pctBase = Number(item.pct_base !== undefined ? item.pct_base : 100.0);
        const pctTarifa = Number(item.pct_tarifa !== undefined ? item.pct_tarifa : 2.0);
        const codConcepto = String(item.codigo_concepto || '055').padStart(3, '0');
        if (idx === 0) codigoPrincipal = codConcepto;

        let sustraendo = 0.0;
        const umbralMinimo = utBs * factorSust;
        if (tipoPersona === 'PN-R' && (pctTarifa === 1 || pctTarifa === 3) && baseImp > umbralMinimo) {
          if (item.sustraendo_bs !== undefined && item.sustraendo_bs !== null && item.sustraendo_bs !== '') {
            sustraendo = Math.max(0, Number(item.sustraendo_bs));
          } else {
            sustraendo = Number((utBs * factorSust * (pctTarifa / 100)).toFixed(2));
          }
        }

        const baseObjeto = baseImp * (pctBase / 100);
        const retencionBruta = baseObjeto * (pctTarifa / 100);
        const impuestoRetenido = Math.max(0, Number((retencionBruta - sustraendo).toFixed(2)));

        totDocBs += montoDoc;
        totBaseBs += baseImp;
        totSustBs += sustraendo;
        totRetBs += impuestoRetenido;

        return {
          libro_compra_id: item.libro_compra_id || null,
          nro_operacion: idx + 1,
          fecha_factura: item.fecha_factura || fecha_emision,
          nro_factura: String(item.nro_factura || '').trim() || 'S/N',
          nro_control: String(item.nro_control || '').trim() || 'S/C',
          nro_nota_debito: String(item.nro_nota_debito || '').trim(),
          nro_nota_credito: String(item.nro_nota_credito || '').trim(),
          tipo_transaccion: item.tipo_transaccion || '01-REG',
          codigo_concepto: codConcepto,
          descripcion_concepto: item.descripcion_concepto || concepto_general || 'SERVICIOS PROFESIONALES / EJECUCIÓN DE OBRAS',
          monto_total_bs: Number(montoDoc.toFixed(2)),
          base_imponible_bs: Number(baseImp.toFixed(2)),
          pct_base: pctBase,
          pct_tarifa: pctTarifa,
          sustraendo_bs: Number(sustraendo.toFixed(2)),
          impuesto_retenido_bs: impuestoRetenido
        };
      });

      const totalAPagar = Number((totDocBs - totRetBs).toFixed(2));
      const now = new Date();
      const pad2 = n => String(n).padStart(2, '0');
      const defaultHora = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
      const defaultFecha = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;

      // Garantizar que la tasa oficial BCV sea la tasa real de la factura o del período (nunca tasas fijas de 68.50)
      let finalTasaBcv = parseFloat(tasa_bcv);
      if (!finalTasaBcv || finalTasaBcv <= 100) {
        const lcId = processedItems.find(it => it.libro_compra_id)?.libro_compra_id;
        if (lcId) {
          const lcRow = await db.execute({ sql: "SELECT tasa_bcv FROM libro_compras WHERE id = ?", args: [lcId] }).catch(() => ({ rows: [] }));
          if (lcRow.rows.length > 0 && Number(lcRow.rows[0].tasa_bcv) > 100) {
            finalTasaBcv = Number(lcRow.rows[0].tasa_bcv);
          }
        }
        if (!finalTasaBcv || finalTasaBcv <= 100) {
          const tasaPer = await db.execute({ sql: "SELECT tasa_bcv FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo || '2026-10'] }).catch(() => ({ rows: [] }));
          if (tasaPer.rows.length > 0 && Number(tasaPer.rows[0].tasa_bcv) > 100) {
            finalTasaBcv = Number(tasaPer.rows[0].tasa_bcv);
          }
        }
        if (!finalTasaBcv || finalTasaBcv <= 100) finalTasaBcv = 880.12;
      }

      // Identificar si es una corrección/actualización de un comprobante existente
      let retencionId = body.id ? Number(body.id) : null;
      let existingComp = null;

      if (retencionId) {
        const byIdRes = await db.execute({ sql: "SELECT * FROM retenciones_islr WHERE id = ? LIMIT 1", args: [retencionId] }).catch(() => ({ rows: [] }));
        if (byIdRes.rows.length > 0) {
          existingComp = byIdRes.rows[0];
          if (await isPeriodoDeclarado(existingComp.periodo, db)) {
            return jsonResponse({
              error: `El comprobante pertenece al período ${existingComp.periodo}, el cual está DECLARADO y CERRADO ante el SENIAT.`
            }, 403);
          }
        }
      }

      if (!retencionId) {
        const lcIds = processedItems.map(it => it.libro_compra_id).filter(Boolean);
        if (lcIds.length > 0) {
          const placeholders = lcIds.map(() => '?').join(',');
          const existDet = await db.execute({
            sql: `SELECT ri.* FROM retenciones_islr ri JOIN retenciones_islr_detalles rid ON ri.id = rid.retencion_id WHERE rid.libro_compra_id IN (${placeholders}) LIMIT 1`,
            args: lcIds
          }).catch(() => ({ rows: [] }));
          if (existDet.rows.length > 0) {
            existingComp = existDet.rows[0];
            retencionId = Number(existingComp.id);
          }
        }
      }

      if (!retencionId && cleanNroComp) {
        const dupRes = await db.execute({
          sql: "SELECT id FROM retenciones_islr WHERE nro_comprobante = ? LIMIT 1",
          args: [cleanNroComp]
        }).catch(() => ({ rows: [] }));
        if (dupRes.rows.length > 0) {
          return jsonResponse({
            error: `El N° de comprobante ${cleanNroComp} ya está asignado a otra retención. Genere un nuevo correlativo.`,
            duplicado: true
          }, 409);
        }
      }

      const finalNroComp = existingComp ? String(existingComp.nro_comprobante) : cleanNroComp;

      if (retencionId) {
        // ACTUALIZACIÓN LEGAL: Conservar estrictamente el número correlativo asignado y actualizar datos/cálculos
        await db.execute({
          sql: `
            UPDATE retenciones_islr SET
              nro_comprobante = ?,
              periodo = ?,
              fecha_emision = ?,
              hora_emision = ?,
              proveedor_id = ?,
              sujeto_rif = ?,
              sujeto_razon_social = ?,
              sujeto_tipo_persona = ?,
              sujeto_direccion = ?,
              sujeto_email = ?,
              sujeto_telefono = ?,
              concepto_general = ?,
              codigo_concepto_principal = ?,
              es_multimoneda = ?,
              moneda_divisa = ?,
              tasa_bcv = ?,
              valor_ut_aplicado = ?,
              total_documento_bs = ?,
              total_base_imponible_bs = ?,
              total_sustraendo_bs = ?,
              total_islr_retenido_bs = ?,
              total_a_pagar_bs = ?,
              observaciones = ?
            WHERE id = ?
          `,
          args: [
            finalNroComp,
            periodo || '2026-10',
            fecha_emision || defaultFecha,
            hora_emision || defaultHora,
            proveedor_id || null,
            cleanRif,
            String(sujeto_razon_social).trim(),
            tipoPersona,
            String(sujeto_direccion || 'CARACAS, DISTRITO CAPITAL').trim(),
            cleanEmail,
            String(sujeto_telefono || '').trim(),
            String(concepto_general || processedItems[0].descripcion_concepto).trim(),
            codigoPrincipal,
            es_multimoneda ? 1 : 0,
            moneda_divisa || 'USD',
            finalTasaBcv,
            utBs,
            Number(totDocBs.toFixed(2)),
            Number(totBaseBs.toFixed(2)),
            Number(totSustBs.toFixed(2)),
            Number(totRetBs.toFixed(2)),
            totalAPagar,
            String(observaciones || '').trim(),
            retencionId
          ]
        });

        // Los detalles se reemplazan atómicamente en db.batch más abajo
      } else {
        // INSERCIÓN NUEVA: Asignar nuevo comprobante para una factura que no ha sido retenida
        const insHeader = await db.execute({
          sql: `
            INSERT INTO retenciones_islr (
              nro_comprobante, periodo, fecha_emision, hora_emision,
              proveedor_id, sujeto_rif, sujeto_razon_social, sujeto_tipo_persona,
              sujeto_direccion, sujeto_email, sujeto_telefono,
              concepto_general, codigo_concepto_principal,
              es_multimoneda, moneda_divisa, tasa_bcv, valor_ut_aplicado,
              total_documento_bs, total_base_imponible_bs, total_sustraendo_bs,
              total_islr_retenido_bs, total_a_pagar_bs, estatus, observaciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EMITIDO', ?)
          `,
          args: [
            finalNroComp,
            periodo || '2026-10',
            fecha_emision || defaultFecha,
            hora_emision || defaultHora,
            proveedor_id || null,
            cleanRif,
            String(sujeto_razon_social).trim(),
            tipoPersona,
            String(sujeto_direccion || 'CARACAS, DISTRITO CAPITAL').trim(),
            cleanEmail,
            String(sujeto_telefono || '').trim(),
            String(concepto_general || processedItems[0].descripcion_concepto).trim(),
            codigoPrincipal,
            es_multimoneda ? 1 : 0,
            moneda_divisa || 'USD',
            finalTasaBcv,
            utBs,
            Number(totDocBs.toFixed(2)),
            Number(totBaseBs.toFixed(2)),
            Number(totSustBs.toFixed(2)),
            Number(totRetBs.toFixed(2)),
            totalAPagar,
            String(observaciones || '').trim()
          ]
        });
        retencionId = Number(insHeader.lastInsertRowid);
      }

      const islrDetailStmts = [];
      if (existingComp) {
        islrDetailStmts.push({
          sql: "DELETE FROM retenciones_islr_detalles WHERE retencion_id = ?",
          args: [retencionId]
        });
      }
      for (const it of processedItems) {
        islrDetailStmts.push({
          sql: `
            INSERT INTO retenciones_islr_detalles (
              retencion_id, libro_compra_id, nro_operacion,
              fecha_factura, nro_factura, nro_control,
              nro_nota_debito, nro_nota_credito, tipo_transaccion,
              codigo_concepto, descripcion_concepto,
              monto_total_bs, base_imponible_bs, pct_base, pct_tarifa,
              sustraendo_bs, impuesto_retenido_bs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          args: [
            retencionId, it.libro_compra_id, it.nro_operacion,
            it.fecha_factura, it.nro_factura, it.nro_control,
            it.nro_nota_debito, it.nro_nota_credito, it.tipo_transaccion,
            it.codigo_concepto, it.descripcion_concepto,
            it.monto_total_bs, it.base_imponible_bs, it.pct_base, it.pct_tarifa,
            it.sustraendo_bs, it.impuesto_retenido_bs
          ]
        });
      }
      if (islrDetailStmts.length > 0) {
        await db.batch(islrDetailStmts, 'write');
      }

      if (cleanRif) {
        await db.execute({
          sql: `UPDATE proveedores SET email = ?, direccion_fiscal = ?, tipo_persona = ?, codigo_concepto_islr = ? WHERE UPPER(REPLACE(REPLACE(rif, '-', ''), ' ', '')) = UPPER(REPLACE(REPLACE(?, '-', ''), ' ', ''))`,
          args: [cleanEmail, String(sujeto_direccion || '').trim(), tipoPersona, codigoPrincipal, cleanRif]
        });
      }

      return jsonResponse({
        success: true,
        id: retencionId,
        nro_comprobante: finalNroComp,
        message: `Comprobante de Retención ISLR N° ${finalNroComp} emitido conforme a la PA SNAT/2026/00093.`
      });
    }

    if (path.startsWith('/api/islr/comprobantes/') && method === 'DELETE') {
      const id = path.split('/')[4];
      const compRes = await db.execute({
        sql: "SELECT periodo FROM retenciones_islr WHERE id = ? LIMIT 1",
        args: [id]
      });
      const targetPeriodo = compRes.rows[0]?.periodo;
      if (targetPeriodo && await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} se encuentra DECLARADO y CERRADO formalmente ante el SENIAT. No se permite eliminar comprobantes de retención de un período cerrado.`
        }, 403);
      }
      await db.execute({ sql: "DELETE FROM retenciones_islr_detalles WHERE retencion_id = ?", args: [id] });
      await db.execute({ sql: "DELETE FROM retenciones_islr WHERE id = ?", args: [id] });
      return jsonResponse({ success: true, message: 'Comprobante eliminado con éxito.' });
    }

    if (path === '/api/islr/config' && method === 'PUT') {
      const body = await request.json();
      const {
        agente_rif, agente_razon_social, agente_direccion, agente_telefono, agente_email,
        valor_ut_bs, factor_sustraendo, nro_resolucion_especial, fecha_resolucion_especial,
        aplica_imprenta_digital, imprenta_razon_social, imprenta_rif, imprenta_providencia, imprenta_fecha_asignacion
      } = body;
      await db.execute({
        sql: `
          UPDATE config_fiscal_islr SET
            agente_rif = COALESCE(?, agente_rif), 
            agente_razon_social = COALESCE(?, agente_razon_social), 
            agente_direccion = COALESCE(?, agente_direccion),
            agente_telefono = COALESCE(?, agente_telefono),
            agente_email = COALESCE(?, agente_email),
            valor_ut_bs = COALESCE(?, valor_ut_bs), 
            factor_sustraendo = COALESCE(?, factor_sustraendo),
            nro_resolucion_especial = COALESCE(?, nro_resolucion_especial), 
            fecha_resolucion_especial = COALESCE(?, fecha_resolucion_especial),
            aplica_imprenta_digital = COALESCE(?, aplica_imprenta_digital),
            imprenta_razon_social = COALESCE(?, imprenta_razon_social),
            imprenta_rif = COALESCE(?, imprenta_rif),
            imprenta_providencia = COALESCE(?, imprenta_providencia),
            imprenta_fecha_asignacion = COALESCE(?, imprenta_fecha_asignacion)
          WHERE id = 1
        `,
        args: [
          agente_rif, agente_razon_social, agente_direccion, agente_telefono, agente_email || 'dg67contable@gmail.com',
          valor_ut_bs, factor_sustraendo, nro_resolucion_especial, fecha_resolucion_especial,
          aplica_imprenta_digital !== undefined ? aplica_imprenta_digital : 1,
          imprenta_razon_social, imprenta_rif, imprenta_providencia, imprenta_fecha_asignacion
        ]
      });
      if (agente_email) {
        await db.execute({ sql: "UPDATE empresas SET email = ? WHERE id = 1", args: [agente_email] }).catch(() => {});
      }
      return jsonResponse({ success: true, message: 'Configuración fiscal actualizada.' });
    }

    if (path === '/api/islr/xml-preview' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const targetPeriodo = periodo === 'TODOS' ? '2026-10' : periodo;
      const [data, cerrado] = await Promise.all([
        obtenerDatosXmlISLR(db, targetPeriodo),
        isPeriodoDeclarado(targetPeriodo, db)
      ]);
      return jsonResponse({
        ...data,
        is_cerrado: cerrado,
        servicio_a_conceptos: SERVICIO_A_CONCEPTOS
      });
    }

    if (path === '/api/islr/export-xml' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const forzar = url.searchParams.get('forzar') === '1' || url.searchParams.get('forzar') === 'true';
      const targetPeriodo = periodo === 'TODOS' ? '2026-10' : periodo;
      const data = await obtenerDatosXmlISLR(db, targetPeriodo);
      if (data.total_lineas === 0 || (!forzar && Array.isArray(data.errores_validacion) && data.errores_validacion.length > 0)) {
        return jsonResponse({
          error: data.total_lineas === 0
            ? `No hay retenciones válidas para exportar XML en el período ${targetPeriodo}.`
            : `Existen errores que impiden validar el XML ante SENIAT: ${data.errores_validacion.join(' | ')}`,
          errores_validacion: data.errores_validacion || []
        }, 400);
      }
      const fileName = `XML_relacionRetencionesISLR_${data.yyyymm}.xml`;
      return new Response(data.xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=ISO-8859-1',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          ...corsHeaders
        }
      });
    }

    if (path === '/api/islr/adecuar-codigos' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const targetPeriodo = body.periodo || '2026-10';
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} se encuentra DECLARADO y CERRADO formalmente ante el SENIAT (Forma 30). No se permite modificar comprobantes emitidos.`
        }, 403);
      }
      const resAdec = await adecuarCodigosRetencionesPeriodo(db, targetPeriodo);
      return jsonResponse({
        success: true,
        actualizadas: resAdec.actualizadas,
        message: resAdec.actualizadas > 0
          ? `Se adecuaron ${resAdec.actualizadas} línea(s) de retención según su Tipo de Servicio y Tipo de Contribuyente.`
          : 'Todas las retenciones del período ya cumplen exactamente con su Tipo de Servicio y Contribuyente.',
        preview: { ...resAdec.previewActualizado, is_cerrado: false }
      });
    }

    if (path === '/api/islr/export-excel-data' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `
        SELECT 
          r.nro_comprobante as "N° COMPROBANTE (14 DÍGITOS)",
          r.periodo as "PERÍODO FISCAL",
          r.fecha_emision as "FECHA EMISIÓN",
          r.hora_emision as "HORA EMISIÓN",
          r.sujeto_rif as "RIF SUJETO RETENIDO",
          r.sujeto_razon_social as "RAZÓN SOCIAL PROVEEDOR",
          r.sujeto_tipo_persona as "TIPO PERSONA",
          r.sujeto_email as "CORREO OBLIGATORIO (PA 00093)",
          d.nro_operacion as "N° OP",
          d.fecha_factura as "FECHA FACTURA",
          d.nro_factura as "N° FACTURA",
          d.nro_control as "N° CONTROL",
          d.codigo_concepto as "CÓD. CONCEPTO",
          d.descripcion_concepto as "DESCRIPCIÓN CONCEPTO",
          d.monto_total_bs as "MONTO TOTAL DOC. (BS)",
          d.base_imponible_bs as "BASE IMPONIBLE (BS)",
          d.pct_base as "% BASE",
          d.pct_tarifa as "% TARIFA ISLR",
          d.sustraendo_bs as "SUSTRAENDO (BS)",
          d.impuesto_retenido_bs as "ISLR RETENIDO (BS)"
        FROM retenciones_islr r
        JOIN retenciones_islr_detalles d ON r.id = d.retencion_id
        WHERE 1=1
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND r.periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY r.periodo ASC, r.nro_comprobante ASC, d.nro_operacion ASC`;
      const resRows = await db.execute({ sql, args });
      return jsonResponse(resRows.rows || []);
    }

    if (path === '/api/reportes/mes-a-mes' && method === 'GET') {
      const monthlyReport = await getMesAMesCompat(db);
      return jsonResponse(monthlyReport);
    }

    if (path === '/api/reportes/libro-inventario-seniat' && method === 'GET') {
      const data = await computeLibroInventarioArt177(db, {
        periodo: url.searchParams.get('periodo') || 'ANUAL_2026',
        desde: url.searchParams.get('desde') || '',
        hasta: url.searchParams.get('hasta') || '',
        almacen: url.searchParams.get('almacen') || 'TODOS',
        categoria: url.searchParams.get('categoria') || 'TODAS'
      });
      return jsonResponse(data);
    }

    if (path === '/api/export/libro-art177' && method === 'GET') {
      const formato = String(url.searchParams.get('formato') || 'csv').toLowerCase();
      const data = await computeLibroInventarioArt177(db, {
        periodo: url.searchParams.get('periodo') || 'ANUAL_2026',
        desde: url.searchParams.get('desde') || '',
        hasta: url.searchParams.get('hasta') || '',
        almacen: url.searchParams.get('almacen') || 'TODOS',
        categoria: url.searchParams.get('categoria') || 'TODAS'
      });
      const rows = mapItemsArt177ExportRows(data.items);
      if (formato === 'json') {
        return jsonResponse({ data, rows });
      }
      const headers = Object.keys(rows[0] || {});
      const csvRows = [headers.join(';')];
      for (const r of rows) {
        csvRows.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="LIBRO_INVENTARIO_ART177_${data.fechaFin}.csv"`,
          ...corsHeaders
        }
      });
    }

    // ----------------------------------------------------
    // EXPORTACIONES COMPATIBLES (EXCEL / CSV OFICIAL SENIAT)
    // ----------------------------------------------------
    if (path === '/api/export/libro-compras' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `
        SELECT 
          nro_operacion as "N_OP",
          fecha as "FECHA",
          rif as "RIF",
          razon_social as "PROVEEDOR",
          nro_factura as "FACTURA",
          COALESCE(nro_control, '') as "CONTROL",
          tipo_transaccion as "TIPO",
          total_bs as "TOTAL_BS",
          0.0 as "EXENTO_BS",
          base_imponible_bs as "BASE_BS",
          (alicuota * 100) || '%' as "ALICUOTA",
          iva_bs as "IVA_BS",
          iva_retenido_bs as "IVA_RETENIDO_BS",
          tipo_servicio as "CLASIFICACION"
        FROM libro_compras
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` WHERE periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY periodo ASC, fecha ASC, nro_operacion ASC`;
      const result = await db.execute({ sql, args });

      const headers = Object.keys(result.rows[0] || {});
      const csvRows = [headers.join(';')];
      for (const r of result.rows) {
        csvRows.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="LIBRO_COMPRAS_DG67_${periodo || 'HISTORICO'}.csv"`,
          ...corsHeaders
        }
      });
    }

    if (path === '/api/export/libro-ventas' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `
        SELECT 
          id as "N_OP",
          fecha as "FECHA",
          COALESCE(numero_reporte_z, '') as "REPORTE_Z",
          COALESCE(serial_impresora, 'Z0A0000176') as "SERIAL_FISCAL",
          COALESCE(factura_desde, '') as "DESDE",
          COALESCE(factura_hasta, '') as "HASTA",
          cantidad_comprobantes as "CANT_COMPROBANTES",
          COALESCE(cantidad_anuladas, 0) as "CANT_ANULADAS",
          COALESCE(facturas_anuladas_lista, '') as "FACTURAS_ANULADAS",
          total_bs as "TOTAL_BS",
          exento_bs as "EXENTO_BS",
          base_imponible_bs as "BASE_BS",
          (alicuota * 100) || '%' as "ALICUOTA",
          iva_bs as "DEBITO_BS"
        FROM libro_ventas
      `;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` WHERE periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY periodo ASC, fecha ASC`;
      const result = await db.execute({ sql, args });

      const headers = Object.keys(result.rows[0] || {});
      const csvRows = [headers.join(';')];
      for (const r of result.rows) {
        csvRows.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="LIBRO_VENTAS_DG67_${periodo || 'HISTORICO'}.csv"`,
          ...corsHeaders
        }
      });
    }

    if (path === '/api/export/excel' && method === 'GET') {
      const fecha_corte = url.searchParams.get('fecha_corte');
      const targetPeriodo = fecha_corte ? String(fecha_corte).slice(0, 7) : '2026-10';
      const tasaRes = await db.execute({
        sql: "SELECT tasa_bcv FROM tasas_bcv_periodo WHERE periodo = ?",
        args: [targetPeriodo]
      });
      const cfgTasaRes = await db.execute("SELECT tasa_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1").catch(() => ({ rows: [] }));
      const tasaCorte = Number(tasaRes.rows[0]?.tasa_bcv || cfgTasaRes.rows[0]?.tasa_bcv_activa_dia || 889.58);

      const joinCond = fecha_corte ? "LEFT JOIN movimientos m ON md.movimiento_id = m.id AND m.fecha <= ?" : "LEFT JOIN movimientos m ON md.movimiento_id = m.id";
      const result = await db.execute({
        sql: `
          SELECT 
            p.codigo as "CODIGO",
            p.descripcion as "DESCRIPCION",
            p.unidad_medida as "UND",
            COALESCE(c.nombre, 'GENERAL') as "CATEGORIA",
            COALESCE(a.nombre, 'PRINCIPAL') as "ALMACEN",
            p.stock_minimo as "STOCK_MIN",
            ROUND(COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0), 2) as "STOCK_ACTUAL",
            p.costo_referencial_usd as "COSTO_REF_USD",
            ROUND(p.costo_referencial_usd * ?, 2) as "COSTO_UNIT_BS",
            ? as "TASA_BCV_APLICADA",
            ROUND(COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0) * p.costo_referencial_usd * ?, 2) as "VALOR_TOTAL_BS",
            ROUND(COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%OMISION%' OR m.subtipo LIKE '%RECLASIF%' OR m.subtipo LIKE '%DEVOLUCION%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo LIKE '%FALTANTE%' OR m.subtipo LIKE '%OBSOLESCENCIA%' OR m.subtipo LIKE '%AUTOCONSUMO%' OR m.subtipo LIKE '%RETIRO%' OR m.subtipo LIKE '%MUESTRA%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0) * p.costo_referencial_usd, 2) as "VALOR_TOTAL_USD"
          FROM productos p
          LEFT JOIN categorias c ON p.categoria_id = c.id
          LEFT JOIN almacenes a ON p.almacen_id = a.id
          LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
          ${joinCond}
          WHERE COALESCE(p.inactivo, 0) = 0 AND COALESCE(p.activo, 1) = 1
          GROUP BY p.id
          ORDER BY p.codigo ASC
        `,
        args: fecha_corte ? [tasaCorte, tasaCorte, tasaCorte, fecha_corte] : [tasaCorte, tasaCorte, tasaCorte]
      });

      const headers = Object.keys(result.rows[0] || {});
      const csvRows = [headers.join(';')];
      for (const r of result.rows) {
        csvRows.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="INVENTARIO_DG67_${fecha_corte || 'AL_DIA'}.csv"`,
          ...corsHeaders
        }
      });
    }

    // Default Fallback
    return jsonResponse({ error: `Operación no disponible (${method} ${path}).` }, 404);

  } catch (err) {
    console.error('API Error:', err);
    return jsonResponse({
      error: traducirErrorNegocio(err),
      path
    }, 500);
  }
}
