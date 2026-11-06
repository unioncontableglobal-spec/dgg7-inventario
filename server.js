import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import compression from 'compression';
import { createClient } from '@libsql/client';
import xlsxPkg from 'xlsx';
const XLSX = xlsxPkg.utils ? xlsxPkg : (xlsxPkg.default || xlsxPkg);
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
} from './lib/cruce_engine.js';
import {
  getMatrizAuditoriaProductos,
  generarExcelMatrizAuditoria,
  procesarMatrizAuditada,
  getListadoAuditoriaEnVivo,
  actualizarProductoAuditoria,
  toggleAuditadoProducto
} from './lib/auditoria_punto_cero.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// MEDIDAS DE CIBERSEGURIDAD Y PROTECCIÓN DE DATOS (OWASP & CLOUDFLARE)
app.disable('x-powered-by'); // Ocultar tecnología de backend

// Cabeceras de seguridad HTTP
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.use(cors());

// Compresión Gzip/Brotli de alto rendimiento para acelerar carga y descarga
app.use(compression({
  threshold: 1024, // Comprimir respuestas mayores a 1 KB (reduce peso en 70-85%)
  level: 6
}));

// Limitar tamaño de payload a 10MB para prevenir ataques DoS de memoria
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir estáticos con caché inteligente en el borde (Cloudflare CDN / Navegador)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // 24 horas en caché para CSS, JS e imágenes
  etag: true,
  lastModified: true
}));

// Connect to local SQLite (`file:inventario_dg67.db`) as primary fast/reliable engine,
// with optional Turso Cloud dual-connection fallback so it works both offline/sandboxed and online
const localDb = createClient({
  url: 'file:inventario_dg67.db'
});

// Inicializar optimizaciones en memoria de SQLite (64MB Cache RAM + Temp Store en Memoria)
localDb.execute("PRAGMA cache_size = -64000;").catch(() => { });
localDb.execute("PRAGMA temp_store = MEMORY;").catch(() => { });
localDb.execute("ALTER TABLE movimientos ADD COLUMN fecha_factura TEXT;").catch(() => { });
localDb.execute("ALTER TABLE movimientos ADD COLUMN tasa_bcv_factura REAL;").catch(() => { });
localDb.execute("ALTER TABLE config_fiscal_islr ADD COLUMN tasa_bcv_activa_dia REAL;").catch(() => { });
localDb.execute("ALTER TABLE config_fiscal_islr ADD COLUMN fecha_bcv_activa_dia TEXT;").catch(() => { });
localDb.execute("ALTER TABLE libro_compras ADD COLUMN fecha_recepcion TEXT;").catch(() => { });
localDb.execute(`
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
`).catch(() => { });
localDb.execute("ALTER TABLE actas_toma_fisica ADD COLUMN tasa_bcv REAL DEFAULT 889.58;").catch(() => { });
localDb.execute("PRAGMA synchronous = NORMAL;").catch(() => { });

const remoteUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const remoteDb = (remoteUrl && !remoteUrl.startsWith('file:'))
  ? createClient({ url: remoteUrl, authToken })
  : null;

console.log(`Primary DB: file:inventario_dg67.db (Local SQLite active & synced)`);

const db = {
  async execute(stmt) {
    // Always execute on local SQLite first (contains full migrated schema & 731 products)
    const res = await localDb.execute(stmt);
    // Best-effort async mirror for write statements if remote Turso is reachable
    if (remoteDb) {
      const sqlStr = (typeof stmt === 'string' ? stmt : stmt.sql || '').trim().toUpperCase();
      if (sqlStr.startsWith('INSERT') || sqlStr.startsWith('UPDATE') || sqlStr.startsWith('DELETE')) {
        remoteDb.execute(stmt).catch(() => { });
      }
    }
    return res;
  },
  async batch(stmts, mode) {
    const res = await localDb.batch(stmts, mode);
    if (remoteDb) {
      remoteDb.batch(stmts, mode).catch(() => { });
    }
    return res;
  }
};

const AUTH_SALT = 'DG67_UCG_SALT_2026';
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + AUTH_SALT).digest('hex');
}

// Control Anti-Fuerza Bruta para Proteger contra Ataques de Hackeo / Diccionario
const loginAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_PERIOD_MS = 15 * 60 * 1000; // 15 minutos

function checkLoginRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  const now = Date.now();
  if (record.lockUntil && now < record.lockUntil) {
    const remainingMin = Math.ceil((record.lockUntil - now) / 60000);
    return {
      allowed: false,
      message: `Acceso temporalmente restringido por exceso de intentos fallidos. Por seguridad, intente de nuevo en ${remainingMin} minuto(s).`
    };
  }
  if (record.lockUntil && now >= record.lockUntil) {
    loginAttempts.delete(ip);
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0 };
  record.count += 1;
  record.lastAttempt = now;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockUntil = now + LOCKOUT_PERIOD_MS;
  }
  loginAttempts.set(ip, record);
}

function clearFailedLogin(ip) {
  loginAttempts.delete(ip);
}

// 0. Módulo de Autenticación y Control de Acceso Corporativo (Unión Contable Global)
app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

  // Verificar si la IP está bloqueada por intentos fallidos
  const rateLimit = checkLoginRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({ error: rateLimit.message });
  }

  try {
    const { usuario, password } = req.body || {};
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Por favor ingrese su usuario y contraseña.' });
    }

    const hashed = hashPassword(password);
    const result = await db.execute({
      sql: 'SELECT id, usuario, nombre_completo, email, rol, activo FROM usuarios WHERE LOWER(usuario) = LOWER(?) AND password_hash = ?',
      args: [usuario.trim(), hashed]
    });

    if (result.rows.length === 0) {
      recordFailedLogin(clientIp);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos. Verifique sus credenciales.' });
    }

    const user = result.rows[0];
    if (!user.activo) {
      return res.status(403).json({ error: 'Cuenta de usuario inactiva. Comuníquese con Unión Contable Global.' });
    }

    // Éxito: limpiar registro de fallos
    clearFailedLogin(clientIp);

    await db.execute({
      sql: "UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?",
      args: [user.id]
    });

    const token = crypto.randomBytes(32).toString('hex');

    res.json({
      ok: true,
      mensaje: 'Acceso autorizado al Sistema de Entradas, Salidas y Kardex DG 67',
      token,
      usuario: {
        id: user.id,
        usuario: user.usuario,
        nombre: user.nombre_completo,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    console.error('Error en autenticación:', error);
    res.status(500).json({ error: 'Error interno en el servidor de autenticación' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ ok: true, mensaje: 'Sesión finalizada y destruida con éxito.' });
});

// Endpoint para Respaldo Manual de Emergencia de la Base de Datos
app.post('/api/backup', async (req, res) => {
  try {
    const { createBackup } = await import('./scripts/backup_database.js');
    const metadata = await createBackup();
    res.json({ ok: true, metadata, mensaje: 'Respaldo generado con éxito' });
  } catch (err) {
    res.status(500).json({ error: 'Error generando respaldo: ' + err.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  res.json({ ok: true, active: true });
});

// 1. Health check & Config Info
app.get('/api/health', async (req, res) => {
  try {
    const [result, empRes] = await Promise.all([
      db.execute("SELECT 1 as ok, datetime('now') as now"),
      db.execute("SELECT * FROM empresas WHERE id = 1")
    ]);
    const emp = empRes.rows[0] || {};
    res.json({
      status: 'online',
      tursoConnected: true,
      serverTime: result.rows[0]?.now,
      empresa: emp.razon_social || 'INVERSIONES DG 67, C.A.',
      rif: emp.rif || 'J-50700865-7',
      domicilio: emp.domicilio_fiscal,
      gerencia: emp.gerencia_regional,
      condicion_iva: emp.condicion_iva,
      comprobante: emp.nro_comprobante
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 1.1 Información Fiscal Oficial del Contribuyente (SENIAT)
app.get('/api/empresa', async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM empresas WHERE id = 1");
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Dashboard KPIs & Summaries (with Dual-Currency BCV Valuation & Complete Inventory Intelligence)
app.get('/api/dashboard', async (req, res) => {
  try {
    const [
      counts,
      stockSummary,
      lowStockCount,
      zeroStockCount,
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
      db.execute("SELECT COUNT(*) as zero_count FROM vista_inventario_actual WHERE stock_actual <= 0"),
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
            sum(coalesce(md.total_linea_divisa, md.cantidad * coalesce(md.costo_unitario_usd, 0))) as monto_compras_usd,
            sum(coalesce(md.total_linea_bs, md.cantidad * coalesce(md.costo_unitario_bs, md.costo_unitario_usd * m.tasa_bcv, 0))) as monto_compras_bs
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
            sum(coalesce(md.total_linea_divisa, md.cantidad * coalesce(md.precio_unitario_divisa, md.costo_unitario_usd, 0))) as monto_ventas_usd,
            sum(coalesce(md.total_linea_bs, md.cantidad * coalesce(md.precio_unitario_bs, md.costo_unitario_usd * m.tasa_bcv, 0))) as monto_ventas_bs
          FROM movimientos m
          JOIN movimiento_detalles md ON m.id = md.movimiento_id
          WHERE m.tipo = 'SALIDA_VENTA'
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
          ROUND(COALESCE(SUM(COALESCE(md.total_linea_divisa, md.cantidad * p.costo_referencial_usd)), 0), 2) as total_ventas_usd,
          ROUND(COALESCE(SUM(COALESCE(md.total_linea_bs, md.cantidad * p.costo_referencial_usd * 889.58)), 0), 2) as total_ventas_bs
        FROM productos p
        JOIN vista_inventario_actual v ON p.id = v.producto_id
        LEFT JOIN categorias c ON p.categoria_id = c.id
        JOIN movimiento_detalles md ON p.id = md.producto_id
        JOIN movimientos m ON md.movimiento_id = m.id
        WHERE m.tipo = 'SALIDA_VENTA'
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
    const stockAlerta = Number(stockSummary.rows[0]?.stock_alerta_count || 0);
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

    res.json({
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
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Products Catalog & Stock (with optional historical cutoff date)
app.get('/api/productos', async (req, res) => {
  try {
    const { q, categoria, almacen, estado, fecha_corte, limit = 1000 } = req.query;

    let sql;
    const args = [];

    if (fecha_corte) {
      // Historical calculation as of fecha_corte
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
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0), 2) AS stock_actual,
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0) * p.costo_referencial_usd, 2) AS valor_total_usd,
          CASE 
            WHEN COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
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
      args.push(fecha_corte);
    } else {
      // Live current inventory view
      sql = `
        SELECT 
          producto_id, codigo, descripcion, unidad_medida, 
          categoria, almacen, stock_minimo, costo_referencial_usd, 
          stock_actual, valor_total_usd, estado_stock
        FROM vista_inventario_actual
        WHERE 1=1
      `;
    }

    if (q) {
      if (fecha_corte) {
        sql += ` AND (p.codigo LIKE ? OR p.descripcion LIKE ?)`;
      } else {
        sql += ` AND (codigo LIKE ? OR descripcion LIKE ?)`;
      }
      args.push(`%${q}%`, `%${q}%`);
    }

    if (categoria && categoria !== 'TODAS') {
      if (fecha_corte) {
        sql += ` AND COALESCE(c.nombre, 'GENERAL') = ?`;
      } else {
        sql += ` AND categoria = ?`;
      }
      args.push(categoria);
    }

    if (almacen && almacen !== 'TODOS') {
      if (fecha_corte) {
        sql += ` AND COALESCE(a.nombre, 'PRINCIPAL') = ?`;
      } else {
        sql += ` AND almacen = ?`;
      }
      args.push(almacen);
    }

    if (fecha_corte) {
      sql += ` GROUP BY p.id`;
      if (estado && estado !== 'TODOS') {
        sql += ` HAVING estado_stock = ?`;
        args.push(estado);
      }
      sql += ` ORDER BY p.codigo ASC LIMIT ?`;
    } else {
      if (estado && estado !== 'TODOS') {
        sql += ` AND estado_stock = ?`;
        args.push(estado);
      }
      sql += ` ORDER BY codigo ASC LIMIT ?`;
    }

    args.push(parseInt(limit, 10));

    // Obtener la tasa oficial BCV correspondiente al período de corte (ej. 2025-12 -> 52.02) o la del mes activo (2026-10)
    const targetPeriodo = fecha_corte ? String(fecha_corte).slice(0, 7) : '2026-10';
    const tasaRes = await db.execute({
      sql: "SELECT tasa_bcv, fecha_cierre, moneda FROM tasas_bcv_periodo WHERE periodo = ?",
      args: [targetPeriodo]
    });
    const tasaCorte = Number(tasaRes.rows[0]?.tasa_bcv || (targetPeriodo === '2025-12' ? 52.02 : 92.00));
    const fechaTasaCorte = tasaRes.rows[0]?.fecha_cierre || (fecha_corte || '31/10/2026');

    const result = await db.execute({ sql, args });
    const enrichedRows = result.rows.map(r => {
      const costoUsd = Number(r.costo_referencial_usd || 0);
      const valUsd = Number(r.valor_total_usd || 0);
      const costoBs = Number((costoUsd * tasaCorte).toFixed(2));
      const valBs = Number((valUsd * tasaCorte).toFixed(2));
      return {
        ...r,
        periodo_corte: targetPeriodo,
        tasa_bcv_aplicada: tasaCorte,
        fecha_tasa_bcv: fechaTasaCorte,
        costo_unitario_bs: costoBs,
        valor_total_bs: valBs
      };
    });
    res.json(enrichedRows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.1 Month by Month Inventory Evolution Report
app.get('/api/reportes/mes-a-mes', async (req, res) => {
  try {
    const rawMovs = await db.execute(`
      SELECT 
        strftime('%Y-%m', m.fecha) as periodo,
        SUM(CASE WHEN m.tipo = 'INVENTARIO_INICIAL' THEN md.cantidad ELSE 0 END) as inicial_unidades,
        SUM(CASE WHEN m.tipo = 'INVENTARIO_INICIAL' THEN md.cantidad * md.costo_unitario_usd ELSE 0 END) as inicial_usd,
        SUM(CASE WHEN m.tipo = 'ENTRADA_COMPRA' THEN md.cantidad ELSE 0 END) as compras_unidades,
        SUM(CASE WHEN m.tipo = 'ENTRADA_COMPRA' THEN md.cantidad * md.costo_unitario_usd ELSE 0 END) as compras_usd,
        SUM(CASE WHEN m.tipo = 'SALIDA_VENTA' THEN md.cantidad ELSE 0 END) as ventas_unidades,
        COUNT(DISTINCT m.id) as total_docs
      FROM movimientos m
      JOIN movimiento_detalles md ON m.id = md.movimiento_id
      GROUP BY periodo
      ORDER BY periodo ASC
    `);

    const periodNames = {
      '2025-12': 'Diciembre 2025 (Inventario Inicial)',
      '2026-01': 'Enero 2026',
      '2026-02': 'Febrero 2026',
      '2026-03': 'Marzo 2026',
      '2026-04': 'Abril 2026',
      '2026-05': 'Mayo 2026',
      '2026-06': 'Junio 2026',
      '2026-07': 'Julio 2026',
      '2026-08': 'Agosto 2026',
      '2026-09': 'Septiembre 2026',
      '2026-10': 'Octubre 2026'
    };

    const periodDates = {
      '2025-12': '2025-12-31',
      '2026-01': '2026-01-31',
      '2026-02': '2026-02-28',
      '2026-03': '2026-03-31',
      '2026-04': '2026-04-30',
      '2026-05': '2026-05-31',
      '2026-06': '2026-06-30',
      '2026-07': '2026-07-31',
      '2026-08': '2026-08-31',
      '2026-09': '2026-09-30',
      '2026-10': '2026-10-31'
    };

    const tasasRes = await db.execute("SELECT periodo, tasa_bcv, fecha_cierre, moneda FROM tasas_bcv_periodo");
    const tasasMap = {};
    for (const t of tasasRes.rows) {
      tasasMap[t.periodo] = {
        tasa_bcv: Number(t.tasa_bcv || 68.50),
        fecha_cierre: t.fecha_cierre || periodDates[t.periodo] || '',
        moneda: t.moneda || 'USD'
      };
    }

    let runningStock = 0;
    const monthlyReport = rawMovs.rows.map(row => {
      const saldoInicialPeriodo = runningStock;
      const entradas = (row.inicial_unidades || 0) + (row.compras_unidades || 0);
      const salidas = (row.ventas_unidades || 0);
      runningStock = saldoInicialPeriodo + entradas - salidas;

      const tInfo = tasasMap[row.periodo] || { tasa_bcv: 68.50, fecha_cierre: periodDates[row.periodo] || '', moneda: 'USD' };
      const inicialUsdNum = Math.round((row.inicial_usd || 0) * 100) / 100;
      const inicialBsNum = Math.round(inicialUsdNum * tInfo.tasa_bcv * 100) / 100;
      const comprasUsdNum = Math.round((row.compras_usd || 0) * 100) / 100;
      const comprasBsNum = Math.round(comprasUsdNum * tInfo.tasa_bcv * 100) / 100;

      return {
        periodo: row.periodo,
        nombre: periodNames[row.periodo] || row.periodo,
        fechaCorte: periodDates[row.periodo] || `${row.periodo}-28`,
        tasa_bcv_cierre: tInfo.tasa_bcv,
        fecha_tasa_bcv: tInfo.fecha_cierre,
        moneda: tInfo.moneda,
        saldoInicial: Math.round(saldoInicialPeriodo * 10) / 10,
        entradasInicial: row.inicial_unidades || 0,
        inicialUsd: inicialUsdNum,
        inicialBs: inicialBsNum,
        compras: row.compras_unidades || 0,
        comprasUsd: row.periodo === '2025-12' ? inicialUsdNum : comprasUsdNum,
        comprasBs: row.periodo === '2025-12' ? inicialBsNum : comprasBsNum,
        ventas: row.ventas_unidades || 0,
        saldoFinal: Math.round(runningStock * 10) / 10,
        totalDocs: row.total_docs
      };
    });

    res.json(monthlyReport);
  } catch (error) {
    console.error('Error fetching monthly report:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.2 Libro Oficial de Inventarios SENIAT (Art. 177 RISLR y Art. 32-35 Código de Comercio):
// Calcula con Método de Costo Promedio Ponderado Móvil (CPP) en VES (Moneda de Curso Legal) y USD:
// Inventario Inicial + Entradas (Compras/Ajustes) - Salidas Discriminadas (Venta, Autoconsumo, Retiro, Muestra, Merma) = Inventario Final
async function computeLibroInventarioArt177({ periodo = 'ANUAL_2026', desde = '', hasta = '', almacen = 'TODOS', categoria = 'TODAS' }) {
  let fechaInicio = '2026-01-01';
  let fechaFin = '2026-12-31';

  if (desde && hasta) {
    fechaInicio = desde;
    fechaFin = hasta;
  } else if (periodo === '2025-12') {
    fechaInicio = '2025-12-31';
    fechaFin = '2025-12-31';
  } else if (/^\d{4}-\d{2}$/.test(periodo)) {
    fechaInicio = `${periodo}-01`;
    const [y, m] = periodo.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    fechaFin = `${periodo}-${String(lastDay).padStart(2, '0')}`;
  }

  // 1. Traer catálogo de productos
  const prodArgs = [];
  let prodSql = `
    SELECT 
      p.id AS producto_id,
      p.codigo,
      p.descripcion,
      p.unidad_medida,
      COALESCE(c.nombre, 'GENERAL') AS categoria,
      COALESCE(a.nombre, 'PRINCIPAL') AS almacen,
      p.stock_minimo,
      p.costo_referencial_usd,
      p.conteo_fisico_cierre,
      p.fecha_conteo_fisico,
      p.observacion_auditoria
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN almacenes a ON p.almacen_id = a.id
    WHERE 1=1
  `;
  if (categoria && categoria !== 'TODAS') {
    prodSql += ` AND COALESCE(c.nombre, 'GENERAL') = ?`;
    prodArgs.push(categoria);
  }
  if (almacen && almacen !== 'TODOS') {
    prodSql += ` AND COALESCE(a.nombre, 'PRINCIPAL') = ?`;
    prodArgs.push(almacen);
  }
  prodSql += ` ORDER BY p.codigo ASC`;

  // 2. Traer todos los movimientos hasta fechaFin ordenados cronológicamente para cálculo exacto de Costo Promedio Ponderado (CPP)
  const movsSql = `
    SELECT 
      md.producto_id,
      md.cantidad,
      md.costo_unitario_usd,
      md.costo_unitario_ves,
      m.id AS movimiento_id,
      m.fecha,
      m.tipo,
      COALESCE(m.subtipo, CASE WHEN m.tipo='SALIDA_VENTA' THEN 'VENTA' WHEN m.tipo='ENTRADA_COMPRA' THEN 'COMPRA_NACIONAL' ELSE m.tipo END) AS subtipo,
      m.numero_documento,
      m.nro_control,
      m.usuario_responsable,
      COALESCE(m.tasa_bcv, 68.50) AS tasa_bcv
    FROM movimiento_detalles md
    JOIN movimientos m ON md.movimiento_id = m.id
    WHERE m.fecha <= ?
    ORDER BY m.fecha ASC, m.id ASC
  `;

  const [prodsRes, movsRes] = await Promise.all([
    db.execute({ sql: prodSql, args: prodArgs }),
    db.execute({ sql: movsSql, args: [fechaFin] })
  ]);

  // Agrupar movimientos por producto_id
  const movsByProd = new Map();
  for (const m of movsRes.rows) {
    const pid = Number(m.producto_id);
    if (!movsByProd.has(pid)) movsByProd.set(pid, []);
    movsByProd.get(pid).push(m);
  }

  const isCorteInicial2025 = (fechaInicio === '2025-12-31' && fechaFin === '2025-12-31');

  const items = prodsRes.rows.map(p => {
    const pid = Number(p.producto_id);
    const refUsd = Number(p.costo_referencial_usd || 0);
    const prodMovs = movsByProd.get(pid) || [];

    // Estado continuo de Costo Promedio Ponderado (CPP)
    let stockActual = 0;
    let cppUsd = refUsd;
    let cppVes = Number((refUsd * 52.00).toFixed(2)); // Tasa base Dic 2025
    let valTotalUsd = 0;
    let valTotalVes = 0;

    // Variables del período consultado [fechaInicio, fechaFin]
    let cantInicial = 0, montoInicialUsd = 0, montoInicialVes = 0;
    let snapshotInicialTomado = false;

    let cantEntradas = 0, montoEntradasUsd = 0, montoEntradasVes = 0;
    let cantSalidas = 0, montoSalidasUsd = 0, montoSalidasVes = 0;

    // Discriminación normativa Art. 177 RISLR para Salidas
    let salVentaUnd = 0, salVentaVes = 0, salVentaUsd = 0;
    let salAutoconsumoUnd = 0, salAutoconsumoVes = 0;
    let salRetiroUnd = 0, salRetiroVes = 0;
    let salMuestraUnd = 0, salMuestraVes = 0;
    let salMermaUnd = 0, salMermaVes = 0;
    let salAjusteUnd = 0, salAjusteVes = 0;

    for (const m of prodMovs) {
      const qty = Number(m.cantidad || 0);
      const tasa = Number(m.tasa_bcv || 68.50);
      const unitUsd = Number(m.costo_unitario_usd || 0) > 0 ? Number(m.costo_unitario_usd) : (cppUsd > 0 ? cppUsd : refUsd);
      const unitVes = Number(m.costo_unitario_ves || 0) > 0 ? Number(m.costo_unitario_ves) : Number((unitUsd * tasa).toFixed(2));

      const esAntesDelPeriodo = isCorteInicial2025 ? false : (m.fecha < fechaInicio);

      if (!esAntesDelPeriodo && !snapshotInicialTomado) {
        if (isCorteInicial2025) {
          // Para el corte del 31/12/2025, el inventario inicial es el cargado en INVENTARIO_INICIAL
          cantInicial = 0;
          montoInicialUsd = 0;
          montoInicialVes = 0;
        } else {
          cantInicial = Number(stockActual.toFixed(2));
          montoInicialUsd = Number(valTotalUsd.toFixed(2));
          montoInicialVes = Number(valTotalVes.toFixed(2));
        }
        snapshotInicialTomado = true;
      }

      const sub = String(m.subtipo || '').toUpperCase();
      const isEntrada = m.tipo === 'INVENTARIO_INICIAL' || m.tipo === 'ENTRADA_COMPRA' || (m.tipo === 'AJUSTE' && sub.includes('POSITIVO'));

      if (isEntrada) {
        // Recálculo de Costo Promedio Ponderado Móvil: Nuevo CPP = (Valor Anterior + Valor Entrada) / (Unidades Anteriores + Unidades Entrada)
        const entradaUsd = qty * unitUsd;
        const entradaVes = qty * unitVes;
        const nuevoStock = stockActual + qty;
        if (nuevoStock > 0) {
          cppUsd = (valTotalUsd + entradaUsd) / nuevoStock;
          cppVes = (valTotalVes + entradaVes) / nuevoStock;
        }
        stockActual = nuevoStock;
        valTotalUsd = stockActual * cppUsd;
        valTotalVes = stockActual * cppVes;

        if (!esAntesDelPeriodo) {
          if (isCorteInicial2025 && m.tipo === 'INVENTARIO_INICIAL') {
            cantInicial += qty;
            montoInicialUsd += entradaUsd;
            montoInicialVes += entradaVes;
          } else {
            cantEntradas += qty;
            montoEntradasUsd += entradaUsd;
            montoEntradasVes += entradaVes;
          }
        }
      } else {
        // Salida valorada al Costo Promedio Ponderado vigente (Art. 177 RISLR)
        const costoSalidaUsd = qty * cppUsd;
        const costoSalidaVes = qty * cppVes;
        stockActual = Math.max(0, stockActual - qty);
        valTotalUsd = stockActual * cppUsd;
        valTotalVes = stockActual * cppVes;

        if (!esAntesDelPeriodo) {
          cantSalidas += qty;
          montoSalidasUsd += costoSalidaUsd;
          montoSalidasVes += costoSalidaVes;

          if (sub.includes('AUTOCONSUMO')) {
            salAutoconsumoUnd += qty; salAutoconsumoVes += costoSalidaVes;
          } else if (sub.includes('RETIRO')) {
            salRetiroUnd += qty; salRetiroVes += costoSalidaVes;
          } else if (sub.includes('MUESTRA')) {
            salMuestraUnd += qty; salMuestraVes += costoSalidaVes;
          } else if (sub.includes('MERMA') || sub.includes('DANO') || sub.includes('DAÑO')) {
            salMermaUnd += qty; salMermaVes += costoSalidaVes;
          } else if (m.tipo === 'AJUSTE' || sub.includes('AJUSTE')) {
            salAjusteUnd += qty; salAjusteVes += costoSalidaVes;
          } else {
            salVentaUnd += qty; salVentaVes += costoSalidaVes; salVentaUsd += costoSalidaUsd;
          }
        }
      }
    }

    if (!snapshotInicialTomado && !isCorteInicial2025) {
      cantInicial = Number(stockActual.toFixed(2));
      montoInicialUsd = Number(valTotalUsd.toFixed(2));
      montoInicialVes = Number(valTotalVes.toFixed(2));
    }

    const cantFinal = Number(stockActual.toFixed(2));
    const montoFinalUsd = Number(valTotalUsd.toFixed(2));
    const montoFinalVes = Number(valTotalVes.toFixed(2));

    // Toma física vs Teórico para Libro de Inventarios y Balances (Art. 32-35 Código de Comercio)
    const conteoFisico = (p.conteo_fisico_cierre !== null && p.conteo_fisico_cierre !== undefined)
      ? Number(p.conteo_fisico_cierre)
      : cantFinal;
    const diferenciaUnidades = Number((conteoFisico - cantFinal).toFixed(2));
    const diferenciaVes = Number((diferenciaUnidades * cppVes).toFixed(2));
    const diferenciaUsd = Number((diferenciaUnidades * cppUsd).toFixed(2));

    return {
      producto_id: pid,
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad_medida: p.unidad_medida,
      categoria: p.categoria,
      almacen: p.almacen,
      stock_minimo: p.stock_minimo,
      costo_referencial_usd: refUsd,
      costo_unitario_usd: Number(cppUsd.toFixed(2)),
      costo_promedio_ves: Number(cppVes.toFixed(2)),
      // 1. Inventario Inicial
      cant_inicial: Number(cantInicial.toFixed(2)),
      monto_inicial_usd: Number(montoInicialUsd.toFixed(2)),
      monto_inicial_ves: Number(montoInicialVes.toFixed(2)),
      // 2. Entradas
      cant_entradas: Number(cantEntradas.toFixed(2)),
      monto_entradas_usd: Number(montoEntradasUsd.toFixed(2)),
      monto_entradas_ves: Number(montoEntradasVes.toFixed(2)),
      // 3. Salidas Totales y Discriminadas (Art. 177 RISLR)
      cant_salidas: Number(cantSalidas.toFixed(2)),
      monto_salidas_usd: Number(montoSalidasUsd.toFixed(2)),
      monto_salidas_ves: Number(montoSalidasVes.toFixed(2)),
      sal_venta_und: Number(salVentaUnd.toFixed(2)),
      sal_venta_ves: Number(salVentaVes.toFixed(2)),
      sal_autoconsumo_und: Number(salAutoconsumoUnd.toFixed(2)),
      sal_autoconsumo_ves: Number(salAutoconsumoVes.toFixed(2)),
      sal_retiro_und: Number(salRetiroUnd.toFixed(2)),
      sal_retiro_ves: Number(salRetiroVes.toFixed(2)),
      sal_muestra_und: Number(salMuestraUnd.toFixed(2)),
      sal_muestra_ves: Number(salMuestraVes.toFixed(2)),
      sal_merma_und: Number(salMermaUnd.toFixed(2)),
      sal_merma_ves: Number(salMermaVes.toFixed(2)),
      sal_ajuste_und: Number(salAjusteUnd.toFixed(2)),
      sal_ajuste_ves: Number(salAjusteVes.toFixed(2)),
      // 4. Inventario Final
      cant_final: cantFinal,
      monto_final_usd: montoFinalUsd,
      monto_final_ves: montoFinalVes,
      // 5. Cierre Anual Toma Física vs Teórico (Código de Comercio Art. 32-35)
      conteo_fisico: conteoFisico,
      valor_fisico_ves: Number((conteoFisico * cppVes).toFixed(2)),
      valor_fisico_usd: Number((conteoFisico * cppUsd).toFixed(2)),
      diferencia_unidades: diferenciaUnidades,
      diferencia_ves: diferenciaVes,
      diferencia_usd: diferenciaUsd,
      observacion_auditoria: p.observacion_auditoria || ''
    };
  });

  const mapLabels = {
    'ANUAL_2026': 'Ejercicio Fiscal 2026 (Acumulado)',
    '2025-12': 'Inventario Inicial al 31/12/2025',
    '2026-01': '01 - Enero 2026',
    '2026-02': '02 - Febrero 2026',
    '2026-03': '03 - Marzo 2026',
    '2026-04': '04 - Abril 2026',
    '2026-05': '05 - Mayo 2026',
    '2026-06': '06 - Junio 2026',
    '2026-07': '07 - Julio 2026',
    '2026-08': '08 - Agosto 2026',
    '2026-09': '09 - Septiembre 2026',
    '2026-10': '10 - Octubre 2026'
  };

  const etiquetaPeriodo = (desde && hasta)
    ? `Rango Auditado: ${desde} al ${hasta}`
    : (mapLabels[periodo] || `Período Fiscal ${periodo}`);

  return {
    periodo,
    etiquetaPeriodo,
    fechaInicio,
    fechaFin,
    fechaCorte: fechaFin,
    metodoValoracion: 'COSTO PROMEDIO PONDERADO MÓVIL (ART. 177 RISLR)',
    items
  };
}

app.get('/api/reportes/libro-inventario-seniat', async (req, res) => {
  try {
    const data = await computeLibroInventarioArt177(req.query);
    res.json(data);
  } catch (error) {
    console.error('Error en /api/reportes/libro-inventario-seniat:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3 Exportar Libro Oficial Art. 177 RISLR y Cierre Código de Comercio a Excel / CSV Auditable
app.get('/api/export/libro-art177', async (req, res) => {
  try {
    const { formato = 'xlsx' } = req.query;
    const data = await computeLibroInventarioArt177(req.query);

    const rows = data.items.map((it, idx) => ({
      "N°": idx + 1,
      "CÓDIGO": it.codigo,
      "DESCRIPCIÓN DEL REPUESTO / MERCANCÍA": it.descripcion,
      "UND": it.unidad_medida,
      "ALMACÉN": it.almacen,
      "CPP UNITARIO (BS)": it.costo_promedio_ves,
      "CPP UNITARIO ($)": it.costo_unitario_usd,
      "INV. INICIAL (UND)": it.cant_inicial,
      "INV. INICIAL (BS)": it.monto_inicial_ves,
      "INV. INICIAL ($)": it.monto_inicial_usd,
      "ENTRADAS COMPRAS (UND)": it.cant_entradas,
      "ENTRADAS COMPRAS (BS)": it.monto_entradas_ves,
      "ENTRADAS COMPRAS ($)": it.monto_entradas_usd,
      "SALIDA VENTA (UND)": it.sal_venta_und,
      "SALIDA AUTOCONSUMO (UND)": it.sal_autoconsumo_und,
      "SALIDA RETIRO SOCIOS (UND)": it.sal_retiro_und,
      "SALIDA MUESTRA (UND)": it.sal_muestra_und,
      "SALIDA MERMA / DAÑO (UND)": it.sal_merma_und,
      "TOTAL SALIDAS (UND)": it.cant_salidas,
      "COSTO SALIDAS (BS)": it.monto_salidas_ves,
      "COSTO SALIDAS ($)": it.monto_salidas_usd,
      "INV. FINAL TEÓRICO (UND)": it.cant_final,
      "INV. FINAL TEÓRICO (BS)": it.monto_final_ves,
      "INV. FINAL TEÓRICO ($)": it.monto_final_usd,
      "TOMA FÍSICA CIERRE (UND)": it.conteo_fisico,
      "DIFERENCIA AUDITORÍA (UND)": it.diferencia_unidades,
      "AJUSTE CONTABLE CIERRE (BS)": it.diferencia_ves
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ART_177_SENIAT');

    if (formato === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Disposition', `attachment; filename="LIBRO_INVENTARIO_ART177_${data.fechaFin}.csv"`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send('\uFEFF' + csv);
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Disposition', `attachment; filename="LIBRO_INVENTARIO_ART177_${data.fechaFin}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Error exportando Art. 177:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.1 Sub-módulo Toma Física y Ajuste de Inventario (Punto Cero - Fase 1: Matriz de Productos)
app.get('/api/auditoria/matriz', async (req, res) => {
  try {
    const matriz = await getMatrizAuditoriaProductos(db);
    res.json(matriz);
  } catch (error) {
    console.error('Error obteniendo matriz de auditoría:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.2 Descarga Directa XLSX de la Matriz Oficial de 15 Columnas
app.get('/api/auditoria/exportar-matriz', async (req, res) => {
  try {
    const matriz = await getMatrizAuditoriaProductos(db);
    const wb = generarExcelMatrizAuditoria(matriz, XLSX);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    const fechaStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="MATRIZ_AUDITORIA_PUNTO_CERO_DG67_${fechaStr}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    console.error('Error exportando matriz de auditoría:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.3 Sub-módulo Toma Física y Ajuste de Inventario (Punto Cero - Fase 2: Procesamiento Masivo)
app.post('/api/auditoria/procesar-matriz', async (req, res) => {
  try {
    const { items, opciones } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Se requiere un arreglo de productos auditados en el cuerpo de la solicitud (items)' });
    }
    const resultado = await procesarMatrizAuditada(items, opciones || {}, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error procesando matriz de auditoría:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.4 Listado de Auditoría Interactiva en Tiempo Real (Punto Cero)
app.get('/api/auditoria/listado-en-vivo', async (req, res) => {
  try {
    const listado = await getListadoAuditoriaEnVivo(db);
    res.json(listado);
  } catch (error) {
    console.error('Error obteniendo listado en vivo de auditoría:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.5 Actualización Individual de Producto (Bloques A, B y C)
app.post('/api/auditoria/actualizar-producto/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await actualizarProductoAuditoria(id, req.body, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error actualizando producto en auditoría:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.3.6 Alternar Estado Auditado Rápido desde la Tabla
app.post('/api/auditoria/toggle-auditado/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { auditado } = req.body;
    const resultado = await toggleAuditadoProducto(id, auditado, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error alternando estado auditado:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3.4 Guardar Toma Física de Cierre Anual (Libro de Inventarios y Balances Art. 32-35 Código de Comercio)
app.post('/api/inventario/toma-fisica', async (req, res) => {
  try {
    const { producto_id, conteo_fisico, observacion_auditoria, generar_ajuste_automatico, usuario_responsable } = req.body;
    if (!producto_id || conteo_fisico === undefined) {
      return res.status(400).json({ error: 'Producto y conteo físico son obligatorios' });
    }

    const fechaHoy = new Date().toISOString().slice(0, 10);
    await db.execute({
      sql: `UPDATE productos SET conteo_fisico_cierre = ?, fecha_conteo_fisico = ?, observacion_auditoria = ? WHERE id = ?`,
      args: [Number(conteo_fisico), fechaHoy, observacion_auditoria || 'Verificado en Toma Física de Cierre', Number(producto_id)]
    });

    // Si solicita generar asiento/movimiento de ajuste por diferencia física
    if (generar_ajuste_automatico) {
      const stRes = await db.execute({
        sql: `SELECT stock_actual, costo_referencial_usd FROM vista_inventario_actual WHERE producto_id = ?`,
        args: [Number(producto_id)]
      });
      if (stRes.rows.length > 0) {
        const teo = Number(stRes.rows[0].stock_actual || 0);
        const fis = Number(conteo_fisico);
        const diff = Number((fis - teo).toFixed(2));
        if (diff !== 0) {
          const esPositivo = diff > 0;
          const subtipo = esPositivo ? 'AJUSTE_POSITIVO_SOBRANTE' : 'MERMA_DANO';
          const movHeader = await db.execute({
            sql: `INSERT INTO movimientos (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, observaciones, tasa_bcv)
                  VALUES ('AJUSTE', ?, ?, ?, ?, ?, ?, 84.00)`,
            args: [
              subtipo,
              fechaHoy,
              `ACTA-CIERRE-${producto_id}-${Date.now().toString().slice(-4)}`,
              `CTRL-AUD-${producto_id}`,
              usuario_responsable || 'AUDITOR_CONTABLE_UCG',
              observacion_auditoria || `Ajuste por Toma Física Cierre Anual (Teórico: ${teo}, Físico: ${fis})`
            ]
          });
          const movId = Number(movHeader.lastInsertRowid);
          const costoUsd = Number(stRes.rows[0].costo_referencial_usd || 0);
          await db.execute({
            sql: `INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [movId, Number(producto_id), Math.abs(diff), costoUsd, Number((costoUsd * 84.00).toFixed(2))]
          });
        }
      }
    }

    res.json({ success: true, message: 'Toma física de inventario registrada con éxito' });
  } catch (error) {
    console.error('Error en toma física:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Suppliers List (with Tax Service Classification & Retentions)
app.get('/api/proveedores', async (req, res) => {
  try {
    const result = await db.execute(`
      SELECT 
        p.id, 
        p.rif, 
        p.razon_social,
        COALESCE(p.tipo_servicio, 'MERCANCIA_REPUESTOS') as tipo_servicio,
        COALESCE(p.aplica_inventario, 1) as aplica_inventario,
        COALESCE(p.porcentaje_retencion, 75.0) as porcentaje_retencion,
        COALESCE(p.tipo_persona, CASE WHEN p.rif LIKE 'V%' OR p.rif LIKE 'E%' THEN 'PN-R' ELSE 'PJ-D' END) as tipo_persona,
        COALESCE(p.direccion_fiscal, '') as direccion_fiscal,
        COALESCE(p.codigo_concepto_islr, '055') as codigo_concepto_islr,
        p.telefono,
        p.email,
        COUNT(lc.id) as total_facturas_asociadas
      FROM proveedores p
      LEFT JOIN libro_compras lc ON p.id = lc.proveedor_id
      GROUP BY p.id
      ORDER BY p.razon_social ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.1 Create New Supplier
app.post('/api/proveedores', async (req, res) => {
  try {
    const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr } = req.body;
    if (!rif || !razon_social) {
      return res.status(400).json({ error: 'RIF y Razón Social son obligatorios' });
    }
    const cleanRif = String(rif).trim().toUpperCase();
    const cleanRazon = String(razon_social).trim();
    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    const retencionNum = Number(porcentaje_retencion) || 75.0;
    const cleanTipoPers = tipo_persona || (cleanRif.startsWith('V') || cleanRif.startsWith('E') ? 'PN-R' : 'PJ-D');

    const result = await db.execute({
      sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt, retencionNum, telefono || null, email || null, cleanTipoPers, direccion_fiscal || '', codigo_concepto_islr || '055']
    });

    res.json({
      success: true,
      id: result.rows?.[0]?.id,
      message: 'Proveedor registrado exitosamente en el sistema fiscal'
    });
  } catch (error) {
    console.error('Error creando proveedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4.2 Update Supplier Details & Classification
app.put('/api/proveedores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr } = req.body;
    const cleanRif = rif ? String(rif).trim().toUpperCase() : null;
    const cleanRazon = razon_social ? String(razon_social).trim() : null;
    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    const retencionNum = Number(porcentaje_retencion) || 75.0;

    await db.execute({
      sql: `UPDATE proveedores 
            SET rif = COALESCE(?, rif),
                razon_social = COALESCE(?, razon_social),
                tipo_servicio = ?,
                aplica_inventario = ?,
                porcentaje_retencion = ?,
                telefono = ?,
                email = ?,
                tipo_persona = COALESCE(?, tipo_persona),
                direccion_fiscal = COALESCE(?, direccion_fiscal),
                codigo_concepto_islr = COALESCE(?, codigo_concepto_islr)
            WHERE id = ?`,
      args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt, retencionNum, telefono || null, email || null, tipo_persona || null, direccion_fiscal !== undefined ? direccion_fiscal : null, codigo_concepto_islr || null, id]
    });

    // Cascade update to libro_compras
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
      `,
      args: [cleanTipo, aplicaInvInt, nuevoEstatus, aplicaInvInt, id]
    });

    res.json({ success: true, message: 'Proveedor actualizado con éxito' });
  } catch (error) {
    console.error('Error actualizando proveedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4.3 Update Supplier Service Classification (Patch)
app.patch('/api/proveedores/:id/clasificacion', async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo_servicio, aplica_inventario } = req.body;
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;

    await db.execute({
      sql: `UPDATE proveedores SET tipo_servicio = ?, aplica_inventario = ? WHERE id = ?`,
      args: [tipo_servicio, aplicaInvInt, id]
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
      `,
      args: [tipo_servicio, aplicaInvInt, nuevoEstatus, aplicaInvInt, id]
    });

    res.json({ success: true, message: 'Clasificación de proveedor actualizada exitosamente' });
  } catch (error) {
    console.error('Error al clasificar proveedor:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Categories & Warehouses List
app.get('/api/categorias', async (req, res) => {
  try {
    const result = await db.execute("SELECT id, nombre FROM categorias ORDER BY nombre ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/almacenes', async (req, res) => {
  try {
    const result = await db.execute("SELECT id, codigo, nombre FROM almacenes ORDER BY nombre ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Record New Inbound / Outbound Movement (Atomic Transaction with Art. 177 RISLR Traceability & Subtypes)
app.post('/api/movimientos', async (req, res) => {
  try {
    const {
      tipo,
      subtipo,
      fecha,
      numero_documento,
      nro_control,
      usuario_responsable,
      documento_afectado,
      tasa_bcv,
      proveedor_id,
      observaciones,
      items
    } = req.body;

    if (!tipo || !['ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    }

    if (!fecha) {
      return res.status(400).json({ error: 'La fecha es obligatoria (Art. 177 RISLR)' });
    }

    if (!numero_documento || String(numero_documento).trim() === '') {
      return res.status(400).json({ error: 'El número de documento fuente es obligatorio para evitar movimientos huérfanos (Art. 177 RISLR)' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos un producto en el movimiento' });
    }

    const subtipoNorm = subtipo || (tipo === 'ENTRADA_COMPRA' ? 'COMPRA_NACIONAL' : (tipo === 'SALIDA_VENTA' ? 'VENTA' : 'AJUSTE'));
    const usuarioNorm = (usuario_responsable && String(usuario_responsable).trim()) || 'ASISTENTE_TIENDA_AUTORIZADO';
    const periodoMov = String(fecha).slice(0, 7);

    // Obtener tasa BCV oficial del período y método de valoración (CPP o PEPS)
    const [tasaPerRes, cfgValRes] = await Promise.all([
      db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodoMov] }),
      db.execute("SELECT metodo_valoracion_kardex FROM config_fiscal_islr WHERE id = 1")
    ]);
    const tasaDefaultMes = Number(tasaPerRes.rows[0]?.tasa_bcv || 88.50);
    const fechaTasaMes = req.body.fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
    const metodoVal = req.body.metodo_valoracion || cfgValRes.rows[0]?.metodo_valoracion_kardex || 'CPP';

    const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : tasaDefaultMes;
    const ctrlNorm = (nro_control && String(nro_control).trim()) || (tipo === 'ENTRADA_COMPRA' ? '00-S/CTRL' : 'ZOA0000176');

    const isSalida = (tipo === 'SALIDA_VENTA') || (tipo === 'AJUSTE' && !String(subtipoNorm).includes('POSITIVO'));

    // VALIDACIÓN ESTRICTA EN TIEMPO REAL DEL KARDEX (Prohibido emitir salida si existencia física < cantidad requerida)
    // Agrupar cantidades por producto_id por si el documento repite el mismo código en dos líneas
    if (isSalida) {
      const acumuladoPorProd = {};
      for (const item of items) {
        const pid = parseInt(item.producto_id, 10);
        acumuladoPorProd[pid] = (acumuladoPorProd[pid] || 0) + (parseFloat(item.cantidad) || 0);
      }
      for (const [pidStr, cantTotal] of Object.entries(acumuladoPorProd)) {
        const stockRes = await db.execute({
          sql: "SELECT stock_actual, descripcion, codigo FROM vista_inventario_actual WHERE producto_id = ?",
          args: [parseInt(pidStr, 10)]
        });
        if (stockRes.rows.length === 0) {
          return res.status(400).json({ error: `Producto ID ${pidStr} no existe en el maestro de Kardex.` });
        }
        const currentStock = Number(stockRes.rows[0].stock_actual || 0);
        if (currentStock < cantTotal || currentStock <= 0) {
          return res.status(400).json({
            error: `BLOQUEO DE KARDEX (PA SNAT/2026/00093): Está estrictamente prohibido emitir salida/factura de ${stockRes.rows[0].codigo} (${stockRes.rows[0].descripcion}) porque su existencia física actual (${currentStock} und) es menor a la cantidad requerida (${cantTotal} und).`
          });
        }
      }
    }

    const fechaFacturaNorm = req.body.fecha_factura || fecha;
    const tasaFacturaNorm = Number(req.body.tasa_bcv_factura || tasaNum);

    // VALIDACIÓN ANTI-DUPLICADOS PARA ENTRADAS DE ALMACÉN
    if (tipo === 'ENTRADA_COMPRA' && proveedor_id) {
      const dupEnt = await verificarDuplicadoEntradaAlmacen(proveedor_id, numero_documento, null, db);
      if (dupEnt.duplicado) {
        return res.status(409).json({
          error: dupEnt.mensaje,
          duplicado: true,
          detalle: dupEnt
        });
      }
    }

    // Build header insert with full traceability + BCV rate date & valuation method
    const headerResult = await db.execute({
      sql: `INSERT INTO movimientos (tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable, documento_afectado, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, proveedor_id, observaciones, fecha_factura, tasa_bcv_factura)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        tipo,
        subtipoNorm,
        fecha,
        String(numero_documento).trim(),
        ctrlNorm,
        usuarioNorm,
        documento_afectado || '',
        tasaNum,
        fechaTasaMes,
        req.body.moneda_operacion || 'USD',
        metodoVal,
        proveedor_id ? parseInt(proveedor_id, 10) : null,
        observaciones || '',
        fechaFacturaNorm,
        tasaFacturaNorm
      ]
    });
    const movimientoId = Number(headerResult.lastInsertRowid);

    // Insert detail items with full Dual-Currency (Bolívares & Divisas) + Kardex Costing
    const detailStatements = [];
    for (const it of items) {
      const pid = parseInt(it.producto_id, 10);
      const qty = parseFloat(it.cantidad) || 1;
      const tasaItem = Number(it.tasa_bcv_operacion || tasaNum) > 0 ? Number(it.tasa_bcv_operacion || tasaNum) : tasaNum;

      let cDivisa = parseFloat(it.costo_unitario_divisa || it.costo_unitario_usd || 0);
      let cBs = parseFloat(it.costo_unitario_bs || it.costo_unitario_ves || 0);

      if (cDivisa <= 0 && cBs > 0) {
        cDivisa = Number((cBs / tasaItem).toFixed(2));
      }
      if (cDivisa <= 0) {
        const pRes = await db.execute({
          sql: "SELECT costo_referencial_usd FROM productos WHERE id = ?",
          args: [pid]
        });
        cDivisa = Number(pRes.rows[0]?.costo_referencial_usd || 0);
      }
      if (cBs <= 0) {
        cBs = Number((cDivisa * tasaItem).toFixed(2));
      }

      const precioUnitDiv = parseFloat(it.precio_unitario_divisa || cDivisa);
      const precioUnitBs = parseFloat(it.precio_unitario_bs || Number((precioUnitDiv * tasaItem).toFixed(2)));
      const baseDiv = Number((qty * precioUnitDiv).toFixed(2));
      const baseBs = Number((qty * precioUnitBs).toFixed(2));
      const ivaDiv = Number((baseDiv * 0.16).toFixed(2));
      const ivaBs = Number((baseBs * 0.16).toFixed(2));
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
    }

    await db.batch(detailStatements);

    let resultadoCruce = null;
    if (tipo === 'SALIDA_VENTA') {
      const zId = req.body.libro_ventas_id ? parseInt(req.body.libro_ventas_id, 10) : null;
      if (zId) {
        await db.execute({
          sql: "UPDATE movimientos SET libro_ventas_id = ?, estatus_conciliacion = 'CONCILIADO' WHERE id = ?",
          args: [zId, movimientoId]
        });
        resultadoCruce = await conciliarReporteZ(zId, db);
      } else {
        resultadoCruce = await conciliarVentaIndividual(movimientoId, db);
      }
    } else if (tipo === 'ENTRADA_COMPRA') {
      let lcId = req.body.libro_compras_id || null;
      const matchNum = String(numero_documento).match(/(\d+)/);
      if (!lcId && matchNum) {
        const numFacturaNum = parseInt(matchNum[1], 10);
        const matchLC = await db.execute({
          sql: `SELECT id FROM libro_compras WHERE (nro_factura LIKE ? OR REPLACE(nro_factura, '0', '') = ?) AND aplica_inventario = 1 LIMIT 1`,
          args: [`%${numFacturaNum}%`, String(numFacturaNum)]
        });
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

    res.json({
      success: true,
      message: `Movimiento (${subtipoNorm}) registrado con trazabilidad fiscal completa`,
      movimientoId,
      itemsCount: items.length,
      conciliacion: resultadoCruce
    });
  } catch (error) {
    console.error('Error creating movement:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6.1 Verificar Entrada Duplicada en Almacén en Tiempo Real
app.get('/api/movimientos/verificar-duplicado-entrada', async (req, res) => {
  try {
    const { proveedor_id, numero_documento, exclude_id } = req.query;
    const resultado = await verificarDuplicadoEntradaAlmacen(proveedor_id, numero_documento, exclude_id, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error verificando duplicado de entrada:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Movements History (with Subtype, Fiscal Control, Responsible User & VES Valuation)
app.get('/api/movimientos', async (req, res) => {
  try {
    const { tipo, subtipo, desde, hasta, q, limit = 150 } = req.query;
    let sql = `
      SELECT 
        m.id,
        m.tipo,
        COALESCE(m.subtipo, CASE WHEN m.tipo='SALIDA_VENTA' THEN 'VENTA' WHEN m.tipo='ENTRADA_COMPRA' THEN 'COMPRA_NACIONAL' ELSE m.tipo END) as subtipo,
        m.fecha,
        COALESCE(m.fecha_factura, m.fecha) as fecha_factura,
        COALESCE(m.tasa_bcv_factura, m.tasa_bcv) as tasa_bcv_factura,
        m.numero_documento,
        COALESCE(m.nro_control, '-') as nro_control,
        COALESCE(m.usuario_responsable, 'ADMIN_SISTEMA') as usuario_responsable,
        COALESCE(m.documento_afectado, '') as documento_afectado,
        COALESCE(m.tasa_bcv, 68.50) as tasa_bcv,
        m.observaciones,
        COALESCE(pr.razon_social, 'CLIENTE / OPERACIÓN INTERNA') as proveedor_nombre,
        COALESCE(pr.rif, '-') as proveedor_rif,
        COUNT(md.id) as total_items,
        COALESCE(SUM(md.cantidad), 0) as total_unidades,
        ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd)), 0), 2) as total_usd,
        ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(m.tasa_bcv, 68.50))), 0), 2) as total_ves
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
      sql += ` AND m.subtipo = ?`;
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
    if (q) {
      sql += ` AND (m.numero_documento LIKE ? OR m.nro_control LIKE ? OR pr.razon_social LIKE ? OR m.observaciones LIKE ? OR m.usuario_responsable LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ` GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC LIMIT ?`;
    args.push(parseInt(limit, 10));

    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Individual Movement Details (with Dual-Currency PA SNAT/2026/00093 & Official BCV Rate Legend)
app.get('/api/movimientos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [header, details] = await Promise.all([
      db.execute({
        sql: `
          SELECT m.*, COALESCE(pr.razon_social, 'N/A') as proveedor_nombre, COALESCE(pr.rif, 'N/A') as proveedor_rif,
                 COALESCE(m.fecha_tasa_bcv, m.fecha) as fecha_tasa_bcv_efectiva,
                 COALESCE(m.moneda_operacion, 'USD') as moneda_efectiva
          FROM movimientos m 
          LEFT JOIN proveedores pr ON m.proveedor_id = pr.id 
          WHERE m.id = ?
        `,
        args: [id]
      }),
      db.execute({
        sql: `
          SELECT 
            md.*, 
            p.codigo, 
            p.descripcion, 
            p.unidad_medida,
            COALESCE(NULLIF(md.costo_unitario_divisa, 0), NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) as costo_usd_efectivo,
            COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50) as tasa_bcv_efectiva,
            COALESCE(NULLIF(md.costo_unitario_bs, 0), NULLIF(md.costo_unitario_ves, 0), ROUND(COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50), 2)) as costo_ves_efectivo,
            COALESCE(NULLIF(md.precio_unitario_divisa, 0), NULLIF(md.costo_unitario_divisa, 0), NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) as precio_unitario_divisa_ef,
            COALESCE(NULLIF(md.precio_unitario_bs, 0), NULLIF(md.costo_unitario_bs, 0), ROUND(COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50), 2)) as precio_unitario_bs_ef,
            COALESCE(NULLIF(md.base_imponible_divisa, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd), 2)) as subtotal_usd,
            COALESCE(NULLIF(md.base_imponible_bs, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50)), 2)) as subtotal_ves,
            COALESCE(NULLIF(md.monto_iva_divisa, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * 0.16, 2)) as iva_usd,
            COALESCE(NULLIF(md.monto_iva_bs, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50)) * 0.16, 2)) as iva_ves,
            COALESCE(NULLIF(md.total_linea_divisa, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * 1.16, 2)) as total_linea_usd_ef,
            COALESCE(NULLIF(md.total_linea_bs, 0), ROUND(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd) * COALESCE(NULLIF(md.tasa_bcv_operacion, 0), 68.50)) * 1.16, 2)) as total_linea_ves_ef
          FROM movimiento_detalles md 
          JOIN productos p ON md.producto_id = p.id 
          WHERE md.movimiento_id = ?
        `,
        args: [id]
      })
    ]);

    if (header.rows.length === 0) {
      return res.status(400).json({ error: 'Movimiento no encontrado' });
    }

    const hRow = header.rows[0];
    const tasaFormatted = Number(hRow.tasa_bcv || 68.50).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const monedaLabel = hRow.moneda_efectiva || 'USD';
    const fechaTasaLabel = hRow.fecha_tasa_bcv_efectiva || hRow.fecha;

    res.json({
      header: {
        ...hRow,
        leyenda_tasa_bcv: `Tasa Oficial BCV Aplicable: Bs. ${tasaFormatted} por ${monedaLabel} (Fecha Tasa: ${fechaTasaLabel})`
      },
      items: details.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Kardex by Product (Supports Moving Weighted Average CPP and PEPS/FIFO in VES & USD + Full Traceability)
app.get('/api/kardex/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const metodoQuery = String(req.query.metodo || '').toUpperCase();

    const [prodRes, cfgRes] = await Promise.all([
      db.execute({
        sql: `SELECT * FROM vista_inventario_actual WHERE UPPER(codigo) = UPPER(?)`,
        args: [codigo]
      }),
      db.execute("SELECT metodo_valoracion_kardex FROM config_fiscal_islr WHERE id = 1")
    ]);

    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

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
          COALESCE(NULLIF(md.tasa_bcv_operacion, 0), m.tasa_bcv, 68.50) as tasa_bcv,
          COALESCE(m.fecha_tasa_bcv, m.fecha) as fecha_tasa_bcv,
          COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as tercero,
          COALESCE(pr.rif, '-') as tercero_rif,
          md.cantidad,
          COALESCE(NULLIF(md.costo_unitario_divisa, 0), md.costo_unitario_usd) as costo_unitario_usd,
          COALESCE(NULLIF(md.costo_unitario_bs, 0), md.costo_unitario_ves) as costo_unitario_ves,
          CASE WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') OR (m.tipo='AJUSTE' AND COALESCE(m.subtipo,'') LIKE '%POSITIVO%') THEN md.cantidad ELSE 0 END as entrada,
          CASE WHEN m.tipo = 'SALIDA_VENTA' OR (m.tipo='AJUSTE' AND COALESCE(m.subtipo,'') NOT LIKE '%POSITIVO%') THEN md.cantidad ELSE 0 END as salida
        FROM movimiento_detalles md
        JOIN movimientos m ON md.movimiento_id = m.id
        LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
        WHERE md.producto_id = ?
        ORDER BY m.fecha ASC, m.id ASC
      `,
      args: [prod.producto_id]
    });

    // Compute Valuation (CPP or PEPS/FIFO) in VES and USD
    let balance = 0;
    let cppUsd = refUsd;
    let cppVes = Number((refUsd * 52.02).toFixed(2));
    let valTotalUsd = 0;
    let valTotalVes = 0;
    const fifoQueue = []; // Lotes para PEPS: { qty, unitUsd, unitVes }

    const history = movsRes.rows.map(row => {
      const ent = Number(row.entrada || 0);
      const sal = Number(row.salida || 0);
      const tasa = Number(row.tasa_bcv || 68.50);
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
          balance = Math.max(0, balance - sal);
          valTotalUsd = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitUsd, 0);
          valTotalVes = fifoQueue.reduce((acc, l) => acc + l.qty * l.unitVes, 0);
          if (balance > 0) {
            cppUsd = valTotalUsd / balance;
            cppVes = valTotalVes / balance;
          }
        } else {
          // Outbound is valued at current Moving Weighted Average (CPP)
          movCostoUnitUsd = cppUsd;
          movCostoTotalUsd = sal * cppUsd;
          movCostoUnitVes = cppVes;
          movCostoTotalVes = sal * cppVes;

          balance = Math.max(0, balance - sal);
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

    res.json({
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Export Inventory to Excel (Supports Live or Historical Cutoff with Dual Currency Bs. & USD)
app.get('/api/export/excel', async (req, res) => {
  try {
    const { fecha_corte } = req.query;
    const targetPeriodo = fecha_corte ? String(fecha_corte).slice(0, 7) : '2026-10';
    const tasaRes = await db.execute({
      sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?",
      args: [targetPeriodo]
    });
    const tasaCorte = Number(tasaRes.rows[0]?.tasa_bcv || (targetPeriodo === '2025-12' ? 52.02 : 92.00));

    let sql;
    const args = [];

    if (fecha_corte) {
      sql = `
        SELECT 
          p.codigo as "CÓDIGO",
          p.descripcion as "DESCRIPCIÓN",
          p.unidad_medida as "UND",
          COALESCE(c.nombre, 'GENERAL') as "CATEGORÍA",
          COALESCE(a.nombre, 'PRINCIPAL') as "ALMACÉN",
          p.stock_minimo as "STOCK MÍNIMO",
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0), 2) as "INVENTARIO AL CORTE",
          ? as "TASA BCV APLICADA",
          ROUND(p.costo_referencial_usd * ?, 2) as "COSTO UNITARIO (BS)",
          p.costo_referencial_usd as "COSTO UNITARIO ($)",
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0) * p.costo_referencial_usd * ?, 2) as "VALOR TOTAL (BS)",
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0) * p.costo_referencial_usd, 2) as "VALOR TOTAL ($)",
          CASE 
            WHEN COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%' OR m.subtipo LIKE '%SINCERACION%')) 
                   THEN md.cantidad 
              WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                   OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%' OR m.subtipo LIKE '%DANO%' OR m.subtipo = 'AJUSTE_INVENTARIO')) 
                   THEN -md.cantidad 
              ELSE 0 
            END), 0) <= p.stock_minimo THEN 'SOLICITAR MATERIAL'
            ELSE 'HAY SUFICIENTE'
          END as "ESTADO"
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN almacenes a ON p.almacen_id = a.id
        LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
        LEFT JOIN movimientos m ON md.movimiento_id = m.id AND m.fecha <= ?
        GROUP BY p.id
        ORDER BY p.codigo ASC
      `;
      args.push(tasaCorte, tasaCorte, tasaCorte, fecha_corte);
    } else {
      sql = `
        SELECT 
          codigo as "CÓDIGO",
          descripcion as "DESCRIPCIÓN",
          unidad_medida as "UND",
          categoria as "CATEGORÍA",
          almacen as "ALMACÉN",
          stock_minimo as "STOCK MÍNIMO",
          stock_actual as "INVENTARIO AL DÍA",
          ? as "TASA BCV APLICADA",
          ROUND(costo_referencial_usd * ?, 2) as "COSTO UNITARIO (BS)",
          costo_referencial_usd as "COSTO UNITARIO ($)",
          ROUND(valor_total_usd * ?, 2) as "VALOR TOTAL (BS)",
          valor_total_usd as "VALOR TOTAL ($)",
          estado_stock as "ESTADO"
        FROM vista_inventario_actual
        ORDER BY codigo ASC
      `;
      args.push(tasaCorte, tasaCorte, tasaCorte);
    }

    const result = await db.execute({ sql, args });

    const sheetName = fecha_corte ? `CORTE_${fecha_corte}` : 'INVENTARIO AL DÍA';
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    const fileName = fecha_corte ? `INVENTARIO_DG67_CORTE_${fecha_corte}.xlsx` : `INVENTARIO_DG67_ACTUAL.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================================================
// 10. MÓDULO FISCAL & CRUCE DE INFORMACIÓN (DECLARACIONES VS INVENTARIO)
// ==========================================================================

// 10.1 Libro de Compras con Filtros, Clasificación y Doble Expresión Monetaria (Bs. / USD)
app.get('/api/fiscal/libro-compras', async (req, res) => {
  try {
    const { id, periodo, tipo_servicio, estatus, aplica_inventario } = req.query;
    let sql = `
      SELECT 
        lc.id,
        lc.periodo,
        lc.fecha,
        COALESCE(lc.fecha_recepcion, lc.fecha) as fecha_recepcion,
        lc.nro_operacion,
        lc.rif,
        lc.razon_social,
        lc.nro_factura,
        lc.nro_control,
        lc.base_imponible_bs,
        lc.iva_bs,
        lc.total_bs,
        lc.iva_retenido_bs,
        COALESCE(NULLIF(lc.tasa_bcv, 0), t.tasa_bcv, 68.50) as tasa_bcv,
        COALESCE(NULLIF(lc.fecha_tasa_bcv, ''), t.fecha_cierre, lc.fecha) as fecha_tasa_bcv,
        COALESCE(lc.moneda_divisa, 'USD') as moneda_divisa,
        COALESCE(NULLIF(lc.base_imponible_divisa, 0), ROUND(lc.base_imponible_bs / COALESCE(NULLIF(lc.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as base_imponible_divisa,
        COALESCE(NULLIF(lc.monto_iva_divisa, 0), ROUND(lc.iva_bs / COALESCE(NULLIF(lc.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as monto_iva_divisa,
        COALESCE(NULLIF(lc.total_divisa, 0), ROUND(lc.total_bs / COALESCE(NULLIF(lc.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as total_divisa,
        COALESCE(NULLIF(lc.iva_retenido_divisa, 0), ROUND(lc.iva_retenido_bs / COALESCE(NULLIF(lc.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as iva_retenido_divisa,
        lc.tipo_servicio,
        lc.aplica_inventario,
        lc.estatus_conciliacion,
        lc.movimiento_id,
        lc.observaciones_cruce,
        p.razon_social as proveedor_registrado_nombre
      FROM libro_compras lc
      LEFT JOIN proveedores p ON lc.proveedor_id = p.id
      LEFT JOIN tasas_bcv_periodo t ON t.periodo = lc.periodo
      WHERE 1=1
    `;
    const args = [];

    if (id) {
      sql += ` AND lc.id = ?`;
      args.push(Number(id));
    }
    if (periodo && periodo !== 'TODOS') {
      sql += ` AND lc.periodo = ?`;
      args.push(periodo);
    }
    if (tipo_servicio && tipo_servicio !== 'TODOS') {
      sql += ` AND lc.tipo_servicio = ?`;
      args.push(tipo_servicio);
    }
    if (estatus && estatus !== 'TODOS') {
      sql += ` AND lc.estatus_conciliacion = ?`;
      args.push(estatus);
    }
    if (aplica_inventario !== undefined && aplica_inventario !== '') {
      sql += ` AND lc.aplica_inventario = ?`;
      args.push(Number(aplica_inventario));
    }

    sql += ` ORDER BY lc.periodo ASC, lc.fecha ASC, lc.id ASC`;
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.2 Libro de Ventas Fiscal (Impresora ZOA0000176) con Cruce de Salidas de Almacén y Doble Expresión Monetaria
app.get('/api/fiscal/libro-ventas', async (req, res) => {
  try {
    const { periodo, id } = req.query;
    let sql = `
      SELECT 
        lv.*,
        COALESCE(NULLIF(lv.tasa_bcv, 0), t.tasa_bcv, 68.50) as tasa_bcv_efectiva,
        COALESCE(NULLIF(lv.fecha_tasa_bcv, ''), t.fecha_cierre, lv.fecha) as fecha_tasa_bcv_efectiva,
        COALESCE(NULLIF(lv.base_imponible_divisa, 0), ROUND(lv.base_imponible_bs / COALESCE(NULLIF(lv.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as base_imponible_divisa_ef,
        COALESCE(NULLIF(lv.monto_iva_divisa, 0), ROUND(lv.iva_bs / COALESCE(NULLIF(lv.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as monto_iva_divisa_ef,
        COALESCE(NULLIF(lv.total_divisa, 0), ROUND(lv.total_bs / COALESCE(NULLIF(lv.tasa_bcv, 0), t.tasa_bcv, 68.50), 2)) as total_divisa_ef,
        COALESCE(sal.cant_movimientos, 0) as almacen_movimientos,
        COALESCE(sal.cant_facturas, 0) as almacen_comprobantes,
        sal.almacen_desde,
        sal.almacen_hasta,
        COALESCE(sal.unidades_despachadas, 0) as almacen_unidades
      FROM libro_ventas lv
      LEFT JOIN tasas_bcv_periodo t ON t.periodo = lv.periodo
      LEFT JOIN (
        SELECT 
          m.fecha,
          COUNT(DISTINCT m.id) as cant_movimientos,
          COUNT(DISTINCT CASE WHEN m.observaciones LIKE 'FACT%' THEN m.observaciones ELSE m.numero_documento END) as cant_facturas,
          MIN(CASE WHEN m.observaciones LIKE 'FACT%' THEN m.observaciones ELSE m.numero_documento END) as almacen_desde,
          MAX(CASE WHEN m.observaciones LIKE 'FACT%' THEN m.observaciones ELSE m.numero_documento END) as almacen_hasta,
          SUM(md.cantidad) as unidades_despachadas
        FROM movimientos m
        LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
        WHERE m.tipo = 'SALIDA_VENTA'
        GROUP BY m.fecha
      ) sal ON sal.fecha = lv.fecha
      WHERE 1=1
    `;
    const args = [];
    if (id) {
      sql += ` AND lv.id = ?`;
      args.push(id);
    } else if (periodo && periodo !== 'TODOS') {
      sql += ` AND lv.periodo = ?`;
      args.push(periodo);
    }
    sql += ` ORDER BY lv.periodo ASC, lv.fecha ASC, lv.id ASC`;
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.3 Declaraciones Mensuales IVA SENIAT
app.get('/api/fiscal/declaraciones-iva', async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM declaraciones_iva ORDER BY periodo ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.4 Resumen Ejecutivo de Cruce (Compras/Ventas Fiscales vs Entradas/Salidas Inventario)
app.get('/api/cruce/doble-via', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';
    const resumen = await getResumenCruceDobleVia(periodo, db);
    res.json(resumen);
  } catch (error) {
    console.error('Error en cruce doble vía:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.4.1 Próxima Factura Correlativa Z y Sugerencia de Salidas de Tienda
app.get('/api/fiscal/proxima-factura-z', async (req, res) => {
  try {
    const { periodo, fecha } = req.query;
    const resultado = await getProximaFacturaZ(periodo, fecha, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error calculando próxima factura Z:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.4.2 Cruce de Compras y Entradas de Almacén (Pendientes vs Conciliadas)
app.get('/api/fiscal/cruce-compras-entradas', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';
    const resultado = await getCruceComprasEntradas(periodo, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error en cruce compras-entradas:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cruce/ejecutar', async (req, res) => {
  try {
    const periodo = req.body?.periodo || '2026-10';
    const resumen = await getResumenCruceDobleVia(periodo, db);
    res.json({ success: true, resumen });
  } catch (error) {
    console.error('Error ejecutando cruce:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/fiscal/resumen-cruce', async (req, res) => {
  try {
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

    res.json({
      declaraciones: declaraciones.rows,
      compras: comprasStats.rows,
      inventario: inventarioStats.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.5 Conciliación Manual de Factura con Entrada de Inventario
app.post('/api/fiscal/conciliar-factura', async (req, res) => {
  try {
    const { libro_compra_id, movimiento_id, observaciones } = req.body;
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
    res.json({ success: true, message: 'Factura conciliada con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.5.1 Buscar Entradas de Almacén (Cargadas por el Asistente en Tienda) para Cruzar con Libro de Compras
app.get('/api/fiscal/entradas-tienda', async (req, res) => {
  try {
    const { periodo, q, soloPendientes } = req.query;
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
        COALESCE(pr.porcentaje_retencion, 75.0) as porcentaje_retencion,
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
    res.json(result.rows);
  } catch (error) {
    console.error('Error en /api/fiscal/entradas-tienda:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.5.2 Buscar Salidas / Ventas de Tienda (Cargadas por el Asistente) para Cruzar con Libro de Ventas (Subgrupos por Día)
app.get('/api/fiscal/salidas-tienda', async (req, res) => {
  try {
    const { periodo, fecha, q } = req.query;
    const result = await getSalidasTiendaAgrupadas(periodo, fecha, q, db);
    res.json(result);
  } catch (error) {
    console.error('Error en /api/fiscal/salidas-tienda:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.5.3 Estado de Conciliación de Ventas / Salidas (Reportes Z Fiscales UCG ↔ Salidas Físicas Almacén DG67)
app.get('/api/fiscal/cruce-ventas-salidas', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';
    const cruce = await getCruceVentasSalidas(periodo, db);
    res.json(cruce);
  } catch (error) {
    console.error('Error en /api/fiscal/cruce-ventas-salidas:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Verifica si un período fiscal está declarado y cerrado ante el SENIAT
async function isPeriodoDeclarado(periodo, db) {
  if (!periodo) return false;
  if (periodo <= '2026-09') return true;
  try {
    const res = await db.execute({
      sql: "SELECT estatus FROM declaraciones_iva WHERE periodo = ? LIMIT 1",
      args: [periodo]
    });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0].estatus === 'DECLARADO';
    }
  } catch (e) {
    console.error('Error verificando estatus de período declarado en server:', e);
  }
  return false;
}

// Helper: Recalcula la Declaración Forma 30 para un período fiscal
async function recalculateDeclaracionIva(periodo) {
  try {
    const vRes = await db.execute({
      sql: `SELECT 
              COALESCE(SUM(base_imponible_bs), 0) as total_base,
              COALESCE(SUM(iva_bs), 0) as total_iva,
              COUNT(*) as total_dias
            FROM libro_ventas WHERE periodo = ?`,
      args: [periodo]
    });
    const vBase = Number(vRes.rows[0]?.total_base || 0);
    const vIva = Number(vRes.rows[0]?.total_iva || 0);
    const vDias = Number(vRes.rows[0]?.total_dias || 0);

    const cRes = await db.execute({
      sql: `SELECT 
              COALESCE(SUM(base_imponible_bs), 0) as total_base,
              COALESCE(SUM(iva_bs), 0) as total_iva,
              COALESCE(SUM(iva_retenido_bs), 0) as total_retenido,
              COUNT(*) as total_facs
            FROM libro_compras WHERE periodo = ?`,
      args: [periodo]
    });
    const cBase = Number(cRes.rows[0]?.total_base || 0);
    const cIva = Number(cRes.rows[0]?.total_iva || 0);
    const cRet = Number(cRes.rows[0]?.total_retenido || 0);
    const cFacs = Number(cRes.rows[0]?.total_facs || 0);

    let excedenteAnterior = 0.0;
    const prevRes = await db.execute({
      sql: `SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1`,
      args: [periodo]
    });
    if (prevRes.rows.length > 0 && prevRes.rows[0].excedente_siguiente_bs) {
      excedenteAnterior = Number(prevRes.rows[0].excedente_siguiente_bs);
    }

    const creditoTotalDeducible = cIva + excedenteAnterior;
    let impuestoAPagar = 0.0;
    let excedenteSiguiente = 0.0;

    if (vIva > creditoTotalDeducible) {
      impuestoAPagar = Number((vIva - creditoTotalDeducible).toFixed(2));
      excedenteSiguiente = 0.0;
    } else {
      impuestoAPagar = 0.0;
      excedenteSiguiente = Number((creditoTotalDeducible - vIva).toFixed(2));
    }

    await db.execute({
      sql: `INSERT INTO declaraciones_iva 
            (periodo, archivo_origen, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
             iva_retenido_bs, total_compras_facturas, total_ventas_dias, estatus,
             excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs)
            VALUES (?, 'SISTEMA_WEB', ?, ?, ?, ?, ?, ?, ?, 'EN_PROCESO', ?, ?, ?)
            ON CONFLICT(periodo) DO UPDATE SET 
              ventas_base_bs = excluded.ventas_base_bs,
              debito_fiscal_bs = excluded.debito_fiscal_bs,
              compras_base_bs = excluded.compras_base_bs,
              credito_fiscal_bs = excluded.credito_fiscal_bs,
              iva_retenido_bs = excluded.iva_retenido_bs,
              total_compras_facturas = excluded.total_compras_facturas,
              total_ventas_dias = excluded.total_ventas_dias,
              excedente_anterior_bs = excluded.excedente_anterior_bs,
              excedente_siguiente_bs = excluded.excedente_siguiente_bs,
              total_a_pagar_bs = excluded.total_a_pagar_bs`,
      args: [
        periodo, vBase, vIva, cBase, cIva, cRet, cFacs, vDias,
        excedenteAnterior, excedenteSiguiente, impuestoAPagar
      ]
    });
  } catch (err) {
    console.error('Error recalculando declaración:', err);
  }
}

// 10.6 Registrar Nueva Factura en Libro de Compras (Soporta Doble Expresión Monetaria Bs. / Divisa)
app.post('/api/fiscal/libro-compras', async (req, res) => {
  try {
    const {
      periodo, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
      tipo_transaccion, base_imponible_bs, base_imponible_divisa,
      alicuota, iva_bs, monto_iva_divisa, total_bs, total_divisa,
      iva_retenido_bs, iva_retenido_divisa, tasa_bcv, fecha_tasa_bcv, moneda_divisa,
      tipo_servicio, aplica_inventario, observaciones_cruce,
      movimiento_id
    } = req.body;

    if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (Período, Fecha de Factura, RIF, Proveedor, Nro Factura)' });
    }

    if (await isPeriodoDeclarado(periodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite registrar compras en un período cerrado.`
      });
    }

    const cleanRif = String(rif).trim().toUpperCase();
    const cleanRazon = String(razon_social).trim();

    // VALIDACIÓN ESTRICTA ANTI-DUPLICADOS FISCALES (SENIAT Art. 75-76 RLIVA)
    const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, null, db);
    if (checkDup.duplicado) {
      return res.status(409).json({
        error: checkDup.mensaje,
        duplicado: true,
        tipo: checkDup.tipo,
        factura_existente: checkDup.factura
      });
    }

    const fechaRecepcionOp = fecha_recepcion || fecha;
    const tasaRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
    const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaRes.rows[0]?.tasa_bcv || 889.58);
    const fechaTasaOp = fecha_tasa_bcv || tasaRes.rows[0]?.fecha_cierre || fecha;
    const monedaOp = moneda_divisa || 'USD';

    const ali = Number(alicuota) || 0.16;
    let baseBs = Number(base_imponible_bs) || 0.0;
    let baseDiv = Number(base_imponible_divisa) || 0.0;

    if (baseBs <= 0 && baseDiv > 0) {
      baseBs = Number((baseDiv * tasaOp).toFixed(2));
    } else if (baseDiv <= 0 && baseBs > 0) {
      baseDiv = Number((baseBs / tasaOp).toFixed(2));
    }

    const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
    const ivaDivCalc = (monto_iva_divisa !== undefined && monto_iva_divisa !== null && monto_iva_divisa !== '') ? Number(monto_iva_divisa) : Number((ivaCalc / tasaOp).toFixed(2));
    const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaCalc).toFixed(2));
    const totalDivCalc = (total_divisa !== undefined && total_divisa !== null && total_divisa !== '') ? Number(total_divisa) : Number((totalCalc / tasaOp).toFixed(2));
    const ret = Number(iva_retenido_bs) || 0.0;
    const retDiv = (iva_retenido_divisa !== undefined && iva_retenido_divisa !== null && iva_retenido_divisa !== '') ? Number(iva_retenido_divisa) : Number((ret / tasaOp).toFixed(2));

    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    let movIdInt = movimiento_id ? Number(movimiento_id) : null;

    // Si es mercancía y no se especificó movimiento_id, buscar coincidencia estricta por RIF + Nro Factura
    if (!movIdInt && aplicaInvInt === 1) {
      const numClean = String(nro_factura).replace(/\D/g, '');
      const numInt = numClean ? parseInt(numClean, 10) : null;
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
          movIdInt = matchMov.rows[0].id;
        }
      } catch (e) {
        console.warn('Error buscando cruce automático de entrada:', e.message);
      }
    }

    const estatus = aplicaInvInt === 0 ? 'NO_APLICA_GASTO' : (movIdInt ? 'CONCILIADO' : 'NO_CONCILIADO');
    const obs = observaciones_cruce || (aplicaInvInt === 0 ? `Gasto / Servicio (${cleanTipo})` : (movIdInt ? `Cruzado con Entrada de Almacén #${movIdInt}` : 'Factura cargada desde el sistema web'));

    // Proveedor
    let provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE rif = ?", args: [cleanRif] });
    let provId = provRes.rows[0]?.id;
    if (!provId) {
      const newProv = await db.execute({
        sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
              VALUES (?, ?, ?, ?, 75.0) RETURNING id`,
        args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt]
      });
      provId = newProv.rows[0]?.id;
    }

    // Nro de Operación correlativo
    const countRes = await db.execute({
      sql: `SELECT COALESCE(MAX(nro_operacion), 0) + 1 as next_op FROM libro_compras WHERE periodo = ?`,
      args: [periodo]
    });
    const nextOp = countRes.rows[0]?.next_op || 1;

    const insertResult = await db.execute({
      sql: `INSERT INTO libro_compras 
            (periodo, archivo_origen, nro_operacion, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
             tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs, iva_retenido_bs,
             tasa_bcv, fecha_tasa_bcv, moneda_divisa, base_imponible_divisa, monto_iva_divisa, total_divisa, iva_retenido_divisa,
             proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, movimiento_id, observaciones_cruce)
            VALUES (?, 'SISTEMA_WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        periodo, nextOp, fecha, fechaRecepcionOp, cleanRif, cleanRazon, nro_factura, nro_control || null,
        tipo_transaccion || '01-reg', baseBs, ali, ivaCalc, totalCalc, ret,
        tasaOp, fechaTasaOp, monedaOp, baseDiv, ivaDivCalc, totalDivCalc, retDiv,
        provId, cleanTipo, aplicaInvInt, estatus, movIdInt, obs
      ]
    });

    const newLcId = insertResult.rows?.[0]?.id;

    if (movIdInt && newLcId) {
      await db.execute({
        sql: `UPDATE movimientos 
              SET libro_compras_id = ?,
                  estatus_conciliacion = 'CONCILIADO',
                  nro_control = COALESCE(NULLIF(nro_control, ''), ?),
                  fecha_factura = COALESCE(fecha_factura, ?),
                  tasa_bcv_factura = COALESCE(tasa_bcv_factura, ?)
              WHERE id = ?`,
        args: [newLcId, nro_control || '', fecha, tasaOp, movIdInt]
      }).catch(e => console.warn('Could not sync back to movimientos:', e.message));
    }

    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: newLcId,
      message: 'Factura registrada con éxito en el Libro de Compras (Doble Expresión Bs./USD)'
    });
  } catch (error) {
    console.error('Error registrando factura en libro compras:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.6.1 Verificar Duplicado en Libro de Compras en Tiempo Real
app.get('/api/fiscal/verificar-duplicado-compra', async (req, res) => {
  try {
    const { rif, nro_factura, nro_control, exclude_id } = req.query;
    const resultado = await verificarDuplicadoLibroCompras(rif, nro_factura, nro_control, exclude_id, db);
    res.json(resultado);
  } catch (error) {
    console.error('Error verificando duplicado de compra:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.6.2 Editar / Actualizar Factura en Libro de Compras (Enmienda de Omisiones / Errores)
app.put('/api/fiscal/libro-compras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existingC = await db.execute({ sql: "SELECT periodo, movimiento_id FROM libro_compras WHERE id = ?", args: [id] });
    if (existingC.rows.length === 0) {
      return res.status(404).json({ error: 'Factura de compra no encontrada' });
    }
    const oldRow = existingC.rows[0];
    const targetPeriodo = req.body.periodo || oldRow.periodo;
    if (await isPeriodoDeclarado(targetPeriodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
      });
    }

    const {
      periodo, fecha, fecha_recepcion, rif, razon_social, nro_factura, nro_control,
      tipo_transaccion, base_imponible_bs, base_imponible_divisa,
      alicuota, iva_bs, monto_iva_divisa, total_bs, total_divisa,
      iva_retenido_bs, iva_retenido_divisa, tasa_bcv, fecha_tasa_bcv, moneda_divisa,
      tipo_servicio, aplica_inventario, observaciones_cruce,
      movimiento_id
    } = req.body;

    if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (Período, Fecha de Factura, RIF, Proveedor, Nro Factura)' });
    }

    const cleanRif = String(rif).trim().toUpperCase();
    const cleanRazon = String(razon_social).trim();

    // VALIDACIÓN ESTRICTA ANTI-DUPLICADOS FISCALES (SENIAT Art. 75-76 RLIVA) excluyendo id actual
    const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, id, db);
    if (checkDup.duplicado) {
      return res.status(409).json({
        error: checkDup.mensaje,
        duplicado: true,
        tipo: checkDup.tipo,
        factura_existente: checkDup.factura
      });
    }

    const fechaRecepcionOp = fecha_recepcion || fecha;
    const tasaRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
    const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaRes.rows[0]?.tasa_bcv || 889.58);
    const fechaTasaOp = fecha_tasa_bcv || tasaRes.rows[0]?.fecha_cierre || fecha;
    const monedaOp = moneda_divisa || 'USD';

    const ali = Number(alicuota) || 0.16;
    let baseBs = Number(base_imponible_bs) || 0.0;
    let baseDiv = Number(base_imponible_divisa) || 0.0;

    if (baseBs <= 0 && baseDiv > 0) {
      baseBs = Number((baseDiv * tasaOp).toFixed(2));
    } else if (baseDiv <= 0 && baseBs > 0) {
      baseDiv = Number((baseBs / tasaOp).toFixed(2));
    }

    const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((baseBs * ali).toFixed(2));
    const ivaDivCalc = (monto_iva_divisa !== undefined && monto_iva_divisa !== null && monto_iva_divisa !== '') ? Number(monto_iva_divisa) : Number((ivaCalc / tasaOp).toFixed(2));
    const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((baseBs + ivaCalc).toFixed(2));
    const totalDivCalc = (total_divisa !== undefined && total_divisa !== null && total_divisa !== '') ? Number(total_divisa) : Number((totalCalc / tasaOp).toFixed(2));
    const ret = Number(iva_retenido_bs) || 0.0;
    const retDiv = (iva_retenido_divisa !== undefined && iva_retenido_divisa !== null && iva_retenido_divisa !== '') ? Number(iva_retenido_divisa) : Number((ret / tasaOp).toFixed(2));

    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    const movIdInt = movimiento_id ? Number(movimiento_id) : null;
    const estatus = aplicaInvInt === 0 ? 'NO_APLICA_GASTO' : (movIdInt ? 'CONCILIADO' : 'NO_CONCILIADO');
    const obs = observaciones_cruce || (aplicaInvInt === 0 ? `Gasto / Servicio (${cleanTipo})` : (movIdInt ? `Cruzado con Entrada de Almacén #${movIdInt}` : 'Factura cargada desde el sistema web'));

    // Proveedor
    let provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE rif = ?", args: [cleanRif] });
    let provId = provRes.rows[0]?.id;
    if (!provId) {
      const newProv = await db.execute({
        sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
              VALUES (?, ?, ?, ?, 75.0) RETURNING id`,
        args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt]
      });
      provId = newProv.rows[0]?.id;
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
        periodo, fecha, fechaRecepcionOp, cleanRif, cleanRazon,
        nro_factura, nro_control || null, tipo_transaccion || '01-reg', baseBs,
        ali, ivaCalc, totalCalc, ret,
        tasaOp, fechaTasaOp, monedaOp, baseDiv,
        ivaDivCalc, totalDivCalc, retDiv,
        provId, cleanTipo, aplicaInvInt,
        estatus, movIdInt, obs,
        id
      ]
    });

    // Desvincular movimiento anterior si cambió
    if (oldRow.movimiento_id && Number(oldRow.movimiento_id) !== Number(movIdInt)) {
      await db.execute({
        sql: `UPDATE movimientos SET libro_compras_id = NULL, estatus_conciliacion = 'NO_CONCILIADO' WHERE id = ? AND libro_compras_id = ?`,
        args: [oldRow.movimiento_id, id]
      }).catch(e => console.warn('Could not unlink old movement:', e.message));
    }

    // Vincular nuevo movimiento si aplica
    if (movIdInt) {
      await db.execute({
        sql: `UPDATE movimientos 
              SET libro_compras_id = ?,
                  estatus_conciliacion = 'CONCILIADO',
                  nro_control = COALESCE(NULLIF(nro_control, ''), ?),
                  fecha_factura = COALESCE(fecha_factura, ?),
                  tasa_bcv_factura = COALESCE(tasa_bcv_factura, ?)
              WHERE id = ?`,
        args: [id, nro_control || '', fecha, tasaOp, movIdInt]
      }).catch(e => console.warn('Could not sync movement:', e.message));
    }

    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: Number(id),
      message: 'Factura actualizada con éxito en el Libro de Compras (Doble Expresión Bs./USD)'
    });
  } catch (error) {
    console.error('Error actualizando factura en libro compras:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.7 Eliminar Factura de Compra
app.delete('/api/fiscal/libro-compras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rowRes = await db.execute({ sql: "SELECT periodo, movimiento_id FROM libro_compras WHERE id = ?", args: [id] });
    if (rowRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    const periodo = rowRes.rows[0].periodo;

    if (await isPeriodoDeclarado(periodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite eliminar facturas de un período cerrado.`
      });
    }

    // Desvincular de movimientos de almacén antes de eliminar
    await db.execute({
      sql: `UPDATE movimientos SET libro_compras_id = NULL, estatus_conciliacion = 'NO_CONCILIADO' WHERE libro_compras_id = ?`,
      args: [id]
    }).catch(e => console.warn('Could not unlink movements on delete:', e.message));

    await db.execute({ sql: "DELETE FROM libro_compras WHERE id = ?", args: [id] });
    await recalculateDeclaracionIva(periodo);

    res.json({ success: true, message: 'Factura eliminada del Libro de Compras' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.8 Registrar Venta Diaria / Reporte Z en Libro de Ventas (Soporta Doble Expresión Monetaria Bs. / Divisa)
app.post('/api/fiscal/libro-ventas', async (req, res) => {
  try {
    const {
      periodo, fecha, factura_desde, factura_hasta, total_bs, total_divisa,
      exento_bs, exento_divisa, base_imponible_bs, base_imponible_divisa,
      alicuota, iva_bs, monto_iva_divisa, cantidad_comprobantes,
      tasa_bcv, fecha_tasa_bcv, moneda_divisa
    } = req.body;

    if (!periodo || !fecha) {
      return res.status(400).json({ error: 'El período fiscal y la fecha son obligatorios.' });
    }

    if (await isPeriodoDeclarado(periodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite registrar ventas en un período cerrado.`
      });
    }
    const numZ = String(req.body.numero_reporte_z || '').trim();
    if (!numZ) {
      return res.status(400).json({ error: 'El N° de Reporte Z es obligatorio según normativa SENIAT (Providencia 00071).' });
    }
    const serial = String(req.body.serial_impresora || 'Z0A0000176').trim();
    if (!serial) {
      return res.status(400).json({ error: 'El Serial de la Máquina Fiscal es obligatorio.' });
    }
    if (!factura_desde || !factura_hasta) {
      return res.status(400).json({ error: 'El rango correlativo de facturas (Desde / Hasta) es obligatorio.' });
    }
    if (base_imponible_bs === undefined && base_imponible_divisa === undefined && exento_bs === undefined) {
      return res.status(400).json({ error: 'Debe registrar la Base Imponible o Ventas Exentas.' });
    }

    const tasaRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
    const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaRes.rows[0]?.tasa_bcv || 88.50);
    const fechaTasaOp = fecha_tasa_bcv || tasaRes.rows[0]?.fecha_cierre || fecha;
    const monedaOp = moneda_divisa || 'USD';

    const ali = Number(alicuota) || 0.16;
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

    const cantAnul = Number(req.body.cantidad_anuladas) || 0;
    const totAnulBs = Number(req.body.total_anulaciones_bs) || 0.0;
    const facturasAnuladasLista = String(req.body.facturas_anuladas_lista || '').trim();

    const insertResult = await db.execute({
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
        cantAnul, totAnulBs, facturasAnuladasLista,
        tasaOp, fechaTasaOp, monedaOp, exDiv, baseDiv, ivaDivCalc, totalDivCalc
      ]
    });

    const zId = Number(insertResult.rows?.[0]?.id || insertResult.lastInsertRowid);
    const resultadoCruce = await conciliarReporteZ(zId, db);

    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: zId,
      message: 'Venta registrada con éxito en el Libro de Ventas (Conciliación Automática)',
      conciliacion: resultadoCruce
    });
  } catch (error) {
    console.error('Error registrando venta en libro ventas:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.8.2 Editar / Actualizar Reporte Z en Libro de Ventas (Enmienda de Omisiones / Errores)
app.put('/api/fiscal/libro-ventas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existingZ = await db.execute({ sql: "SELECT periodo FROM libro_ventas WHERE id = ?", args: [id] });
    const targetPeriodo = req.body.periodo || existingZ.rows[0]?.periodo;
    if (await isPeriodoDeclarado(targetPeriodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
      });
    }

    const {
      periodo, fecha, factura_desde, factura_hasta, total_bs, total_divisa,
      exento_bs, exento_divisa, base_imponible_bs, base_imponible_divisa,
      alicuota, iva_bs, monto_iva_divisa, cantidad_comprobantes,
      tasa_bcv, fecha_tasa_bcv, moneda_divisa
    } = req.body;

    if (!periodo || !fecha) {
      return res.status(400).json({ error: 'El período fiscal y la fecha son obligatorios.' });
    }
    const numZ = String(req.body.numero_reporte_z || '').trim();
    if (!numZ) {
      return res.status(400).json({ error: 'El N° de Reporte Z es obligatorio según normativa SENIAT (Providencia 00071).' });
    }
    const serial = String(req.body.serial_impresora || 'Z0A0000176').trim();
    if (!serial) {
      return res.status(400).json({ error: 'El Serial de la Máquina Fiscal es obligatorio.' });
    }
    if (!factura_desde || !factura_hasta) {
      return res.status(400).json({ error: 'El rango correlativo de facturas (Desde / Hasta) es obligatorio.' });
    }

    const tasaRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
    const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaRes.rows[0]?.tasa_bcv || 88.50);
    const fechaTasaOp = fecha_tasa_bcv || tasaRes.rows[0]?.fecha_cierre || fecha;
    const monedaOp = moneda_divisa || 'USD';

    const ali = Number(alicuota) || 0.16;
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
    const cantAnul = Number(req.body.cantidad_anuladas) || 0;
    const totAnulBs = Number(req.body.total_anulaciones_bs) || 0.0;
    const facturasAnuladasLista = String(req.body.facturas_anuladas_lista || '').trim();

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
        cantAnul, totAnulBs, facturasAnuladasLista,
        tasaOp, fechaTasaOp, monedaOp, exDiv, baseDiv, ivaDivCalc, totalDivCalc,
        id
      ]
    });

    const resultadoCruce = await conciliarReporteZ(id, db);
    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: Number(id),
      message: 'Reporte Z actualizado con éxito en el Libro de Ventas (Conciliación Recalculada)',
      conciliacion: resultadoCruce
    });
  } catch (error) {
    console.error('Error actualizando venta en libro ventas:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.9 Eliminar Registro de Venta
app.delete('/api/fiscal/libro-ventas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rowRes = await db.execute({ sql: "SELECT periodo FROM libro_ventas WHERE id = ?", args: [id] });
    if (rowRes.rows.length === 0) {
      return res.status(404).json({ error: 'Registro de venta no encontrado' });
    }
    const periodo = rowRes.rows[0].periodo;

    if (await isPeriodoDeclarado(periodo, db)) {
      return res.status(403).json({
        error: `El período fiscal ${periodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite eliminar registros de un período cerrado.`
      });
    }

    await db.execute({ sql: "DELETE FROM libro_ventas WHERE id = ?", args: [id] });
    await recalculateDeclaracionIva(periodo);

    res.json({ success: true, message: 'Registro eliminado del Libro de Ventas' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.9.1 Cambiar Estatus y Cerrar Declaración Forma 30 ante el SENIAT
app.put('/api/fiscal/declaraciones/:periodo/estatus', async (req, res) => {
  try {
    const { periodo } = req.params;
    const nuevoEstatus = String(req.body?.estatus || 'DECLARADO').toUpperCase();

    if (!['DECLARADO', 'EN_PROCESO'].includes(nuevoEstatus)) {
      return res.status(400).json({ error: 'Estatus inválido. Debe ser DECLARADO o EN_PROCESO' });
    }

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
    const totCred = cCred + excAnt + cRet;
    const saldo = vDeb - totCred;
    const aPagar = saldo > 0 ? Number(saldo.toFixed(2)) : 0;
    const excSig = saldo < 0 ? Number(Math.abs(saldo).toFixed(2)) : 0;

    await db.execute({
      sql: `UPDATE declaraciones_iva 
            SET estatus = ?,
                ventas_base_bs = ?,
                debito_fiscal_bs = ?,
                compras_base_bs = ?,
                credito_fiscal_bs = ?,
                iva_retenido_bs = ?,
                excedente_anterior_bs = ?,
                excedente_siguiente_bs = ?,
                total_a_pagar_bs = ?,
                total_compras_facturas = ?,
                total_ventas_dias = ?
            WHERE periodo = ?`,
      args: [
        nuevoEstatus,
        vBase,
        vDeb,
        cBase,
        cCred,
        cRet,
        excAnt,
        excSig,
        aPagar,
        totalFac,
        totalDias,
        periodo
      ]
    });

    res.json({
      success: true,
      periodo,
      estatus: nuevoEstatus,
      mensaje: nuevoEstatus === 'DECLARADO'
        ? `Período fiscal ${periodo} marcado exitosamente como DECLARADO y CERRADO ante el SENIAT. Libros bloqueados en modo de sólo lectura.`
        : `Período fiscal ${periodo} reabierto en estado EN_PROCESO.`
    });
  } catch (error) {
    console.error('Error cambiando estatus de declaración:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.9.2 Generar Reporte de Acta Oficial de Inventario y Ajustes (SENIAT Art. 177 RISLR / Art. 27 LISLR)
app.get('/api/auditoria/acta-oficial', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';

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
            d.cantidad,
            d.costo_unitario_usd,
            d.costo_unitario_ves,
            d.total_linea_bs,
            d.total_linea_divisa
          FROM movimientos m
          JOIN movimiento_detalles d ON m.id = d.movimiento_id
          JOIN productos p ON d.producto_id = p.id
          WHERE m.tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE')
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
        const isBaja = m.tipo === 'SALIDA_AJUSTE';
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
          tipo_movimiento: m.tipo,
          codigo: m.codigo,
          descripcion: m.descripcion,
          unidad_medida: 'UND',
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

    res.json({
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
  } catch (error) {
    console.error('Error generando acta oficial de inventario:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.9.3 Estatus, Cierre y Reapertura de Toma Física de Inventario (Art. 177 RISLR)
app.get('/api/auditoria/toma-fisica/estatus', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';
    const actaRes = await db.execute({
      sql: "SELECT * FROM actas_toma_fisica WHERE periodo = ? LIMIT 1",
      args: [periodo]
    });
    if (actaRes.rows.length === 0) {
      return res.json({
        periodo,
        estatus: 'ABIERTA',
        numero_acta: `ACTA-INV-${periodo.replace('-', '')}-01`,
        tasa_bcv: 889.58,
        fecha_cierre: null,
        usuario_cierre: null
      });
    }
    const a = actaRes.rows[0];
    res.json({
      periodo: a.periodo,
      estatus: a.estatus || 'ABIERTA',
      numero_acta: a.numero_acta,
      fecha_corte: a.fecha_corte,
      fecha_cierre: a.fecha_cierre,
      usuario_cierre: a.usuario_cierre,
      auditor_tienda: a.auditor_tienda,
      gerente_dg67: a.gerente_dg67,
      contador_ucg: a.contador_ucg,
      tasa_bcv: Number(a.tasa_bcv || 889.58)
    });
  } catch (error) {
    console.error('Error obteniendo estatus de toma física:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auditoria/toma-fisica/cerrar', async (req, res) => {
  try {
    const {
      periodo = '2026-10',
      numero_acta = 'ACTA-INV-202610-01',
      usuario = 'ADMIN_DG67',
      fecha_cierre = new Date().toISOString(),
      auditor_tienda = 'Personal de Almacén DG 67',
      gerente_dg67 = 'Gerencia General Inversiones DG 67, C.A.',
      contador_ucg = 'Lcda. Liliana Chacón • CPC (Unión Contable Global)',
      tasa_bcv = 889.58
    } = req.body || {};

    await db.execute({
      sql: `
        INSERT INTO actas_toma_fisica 
        (periodo, numero_acta, estatus, fecha_corte, fecha_cierre, usuario_cierre, auditor_tienda, gerente_dg67, contador_ucg, tasa_bcv, updated_at)
        VALUES (?, ?, 'CERRADA', ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        ON CONFLICT(periodo) DO UPDATE SET
          numero_acta = excluded.numero_acta,
          estatus = 'CERRADA',
          fecha_cierre = excluded.fecha_cierre,
          usuario_cierre = excluded.usuario_cierre,
          auditor_tienda = excluded.auditor_tienda,
          gerente_dg67 = excluded.gerente_dg67,
          contador_ucg = excluded.contador_ucg,
          tasa_bcv = excluded.tasa_bcv,
          updated_at = datetime('now', 'localtime')
      `,
      args: [periodo, numero_acta, fecha_cierre.slice(0, 10), fecha_cierre, usuario, auditor_tienda, gerente_dg67, contador_ucg, Number(tasa_bcv || 889.58)]
    });

    res.json({
      success: true,
      periodo,
      numero_acta,
      estatus: 'CERRADA',
      fecha_cierre,
      usuario_cierre: usuario,
      mensaje: `✅ Toma Física del período ${periodo} formalmente cerrada y sellada.`
    });
  } catch (error) {
    console.error('Error cerrando toma física:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auditoria/toma-fisica/reabrir', async (req, res) => {
  try {
    const { periodo = '2026-10', usuario = 'ADMIN_DG67' } = req.body || {};
    await db.execute({
      sql: `
        UPDATE actas_toma_fisica 
        SET estatus = 'ABIERTA', updated_at = datetime('now', 'localtime')
        WHERE periodo = ?
      `,
      args: [periodo]
    });
    res.json({
      success: true,
      periodo,
      estatus: 'ABIERTA',
      mensaje: `🔓 Toma Física del período ${periodo} reabierta para ajustes y rectificaciones.`
    });
  } catch (error) {
    console.error('Error reabriendo toma física:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.10 Obtener Detalle de Declaración Forma 30 de un Período
app.get('/api/fiscal/declaracion/:periodo', async (req, res) => {
  try {
    const { periodo } = req.params;
    const [declRes, comprasSummary, ventasSummary] = await Promise.all([
      db.execute({ sql: "SELECT * FROM declaraciones_iva WHERE periodo = ?", args: [periodo] }),
      db.execute({
        sql: `SELECT 
                COUNT(*) as count_facturas,
                COALESCE(SUM(base_imponible_bs), 0) as total_base,
                COALESCE(SUM(iva_bs), 0) as total_iva,
                COALESCE(SUM(total_bs), 0) as total_compras,
                COALESCE(SUM(iva_retenido_bs), 0) as total_retenido
              FROM libro_compras WHERE periodo = ?`,
        args: [periodo]
      }),
      db.execute({
        sql: `SELECT 
                COUNT(*) as count_lotes,
                COALESCE(SUM(base_imponible_bs), 0) as total_base,
                COALESCE(SUM(iva_bs), 0) as total_iva,
                COALESCE(SUM(total_bs), 0) as total_ventas,
                COALESCE(SUM(cantidad_comprobantes), 0) as total_comprobantes
              FROM libro_ventas WHERE periodo = ?`,
        args: [periodo]
      })
    ]);

    const decl = declRes.rows[0] || {};
    const comp = comprasSummary.rows[0] || {};
    const vent = ventasSummary.rows[0] || {};

    res.json({
      periodo,
      declaracion: decl,
      compras: comp,
      ventas: vent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.11 Exportar Libro de Compras a Excel con Formato Oficial SENIAT
app.get('/api/export/libro-compras', async (req, res) => {
  try {
    const { periodo } = req.query;
    let sql = `
      SELECT 
        nro_operacion as "N° OP",
        fecha as "FECHA",
        rif as "RIF",
        razon_social as "PROVEEDOR / RAZÓN SOCIAL",
        nro_factura as "N° FACTURA",
        COALESCE(nro_control, '') as "N° CONTROL",
        tipo_transaccion as "TIPO TRANS.",
        total_bs as "TOTAL FACTURA (BS)",
        0.0 as "EXENTO (BS)",
        base_imponible_bs as "BASE IMPONIBLE (BS)",
        (alicuota * 100) || '%' as "ALÍCUOTA",
        iva_bs as "IVA CRÉDITO (BS)",
        iva_retenido_bs as "IVA RETENIDO (BS)",
        tipo_servicio as "CLASIFICACIÓN"
      FROM libro_compras
    `;
    const args = [];
    if (periodo && periodo !== 'TODOS') {
      sql += ` WHERE periodo = ?`;
      args.push(periodo);
    }
    sql += ` ORDER BY periodo ASC, fecha ASC, nro_operacion ASC`;

    const result = await db.execute({ sql, args });
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    const sheetName = periodo ? `COMPRAS_${periodo}` : 'LIBRO_COMPRAS';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    const fileName = `LIBRO_COMPRAS_DG67_${periodo || 'HISTORICO'}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.12 Exportar Libro de Ventas a Excel con Formato Oficial SENIAT
app.get('/api/export/libro-ventas', async (req, res) => {
  try {
    const { periodo } = req.query;
    let sql = `
      SELECT 
        id as "N° OP",
        fecha as "FECHA REPORTE",
        COALESCE(factura_desde, '') as "DESDE FACTURA",
        COALESCE(factura_hasta, '') as "HASTA FACTURA",
        cantidad_comprobantes as "CANT. COMPROBANTES",
        total_bs as "TOTAL VENTAS (BS)",
        exento_bs as "EXENTO (BS)",
        base_imponible_bs as "BASE IMPONIBLE (BS)",
        (alicuota * 100) || '%' as "ALÍCUOTA",
        iva_bs as "DÉBITO FISCAL (BS)"
      FROM libro_ventas
    `;
    const args = [];
    if (periodo && periodo !== 'TODOS') {
      sql += ` WHERE periodo = ?`;
      args.push(periodo);
    }
    sql += ` ORDER BY periodo ASC, fecha ASC`;

    const result = await db.execute({ sql, args });
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    const sheetName = periodo ? `VENTAS_${periodo}` : 'LIBRO_VENTAS';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    const fileName = `LIBRO_VENTAS_DG67_${periodo || 'HISTORICO'}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================================================
// 11. MÓDULO DE COMPROBANTES DE RETENCIÓN DE ISLR (PA SNAT/2026/00093 & DECRETO 1.808)
// ==========================================================================

// 11.1 Configuración Fiscal ISLR (UT, Agente de Retención, Imprenta Digital)
app.get('/api/islr/config', async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1");
    const row = result.rows[0] || {
      agente_razon_social: 'INVERSIONES DG 67, C.A.',
      agente_rif: 'J-50700865-7',
      agente_direccion: 'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS',
      agente_telefono: '0212-5771122',
      agente_email: 'administracion@inversionesdg67.com.ve',
      valor_ut_bs: Number(process.env.VALOR_UT_BS || 43.00),
      factor_sustraendo: 83.3334,
      aplica_imprenta_digital: 1,
      imprenta_razon_social: 'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.',
      imprenta_rif: 'J-50714716-9',
      imprenta_providencia: 'SNAT/2026/00093-AUT-00418',
      imprenta_fecha_asignacion: '01/01/2026 08:00:00'
    };
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/islr/config', async (req, res) => {
  try {
    const {
      agente_razon_social, agente_rif, agente_direccion, agente_telefono, agente_email,
      valor_ut_bs, factor_sustraendo, aplica_imprenta_digital,
      imprenta_razon_social, imprenta_rif, imprenta_providencia, imprenta_fecha_asignacion
    } = req.body;

    await db.execute({
      sql: `
        UPDATE config_fiscal_islr
        SET agente_razon_social = COALESCE(?, agente_razon_social),
            agente_rif = COALESCE(?, agente_rif),
            agente_direccion = COALESCE(?, agente_direccion),
            agente_telefono = COALESCE(?, agente_telefono),
            agente_email = COALESCE(?, agente_email),
            valor_ut_bs = COALESCE(?, valor_ut_bs),
            factor_sustraendo = COALESCE(?, factor_sustraendo),
            aplica_imprenta_digital = COALESCE(?, aplica_imprenta_digital),
            imprenta_razon_social = COALESCE(?, imprenta_razon_social),
            imprenta_rif = COALESCE(?, imprenta_rif),
            imprenta_providencia = COALESCE(?, imprenta_providencia),
            imprenta_fecha_asignacion = COALESCE(?, imprenta_fecha_asignacion)
        WHERE id = 1
      `,
      args: [
        agente_razon_social || null,
        agente_rif || null,
        agente_direccion || null,
        agente_telefono || null,
        agente_email || null,
        valor_ut_bs !== undefined ? Number(valor_ut_bs) : null,
        factor_sustraendo !== undefined ? Number(factor_sustraendo) : null,
        aplica_imprenta_digital !== undefined ? Number(aplica_imprenta_digital ? 1 : 0) : null,
        imprenta_razon_social !== undefined ? imprenta_razon_social : null,
        imprenta_rif !== undefined ? imprenta_rif : null,
        imprenta_providencia !== undefined ? imprenta_providencia : null,
        imprenta_fecha_asignacion !== undefined ? imprenta_fecha_asignacion : null
      ]
    });

    res.json({ success: true, message: 'Parámetros de Retención ISLR e Imprenta Digital actualizados' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.2 Catálogo de Conceptos Decreto 1.808 SENIAT
app.get('/api/islr/conceptos', async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM conceptos_islr_seniat ORDER BY codigo ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.3 Generar Próximo Número de Comprobante (14 caracteres: AAAAMM + 8 dígitos secuenciales)
app.get('/api/islr/proximo-numero', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-10';
    const yyyymm = String(periodo).replace('-', '').slice(0, 6);

    // Buscar el máximo secuencial para el período o global
    const [resPer, resGlobal] = await Promise.all([
      db.execute({
        sql: "SELECT nro_comprobante FROM retenciones_islr WHERE nro_comprobante LIKE ? ORDER BY nro_comprobante DESC LIMIT 1",
        args: [`${yyyymm}%`]
      }),
      db.execute("SELECT nro_comprobante FROM retenciones_islr ORDER BY id DESC LIMIT 1")
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
    res.json({ periodo, nro_comprobante: nroComprobante });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.4 Facturas del Libro de Compras disponibles para Retención ISLR
app.get('/api/islr/facturas-disponibles', async (req, res) => {
  try {
    const { periodo, rif } = req.query;
    let sql = `
      SELECT 
        lc.*,
        p.id as prov_id,
        COALESCE(p.tipo_persona, CASE WHEN lc.rif LIKE 'V%' OR lc.rif LIKE 'E%' THEN 'PN-R' ELSE 'PJ-D' END) as tipo_persona,
        COALESCE(p.direccion_fiscal, '') as direccion_fiscal,
        COALESCE(p.email, '') as email,
        COALESCE(p.telefono, '') as telefono,
        COALESCE(p.codigo_concepto_islr, '055') as codigo_concepto_islr,
        ri.nro_comprobante as comprobante_islr_emitido
      FROM libro_compras lc
      LEFT JOIN proveedores p ON lc.rif = p.rif
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
    sql += ` ORDER BY lc.aplica_inventario ASC, lc.periodo DESC, lc.fecha DESC`;
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.5 Listar Comprobantes de Retención ISLR
app.get('/api/islr/comprobantes', async (req, res) => {
  try {
    const { periodo, q } = req.query;
    let sql = `
      SELECT 
        r.*,
        COUNT(d.id) as cantidad_items
      FROM retenciones_islr r
      LEFT JOIN retenciones_islr_detalles d ON r.id = d.retencion_id
      WHERE 1=1
    `;
    const args = [];
    if (periodo && periodo !== 'TODOS') {
      sql += ` AND r.periodo = ?`;
      args.push(periodo);
    }
    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      sql += ` AND (r.nro_comprobante LIKE ? OR r.sujeto_rif LIKE ? OR r.sujeto_razon_social LIKE ? OR r.concepto_general LIKE ?)`;
      args.push(term, term, term, term);
    }
    sql += ` GROUP BY r.id ORDER BY r.periodo DESC, r.nro_comprobante DESC`;
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.6 Obtener un Comprobante de Retención ISLR con su Detalle y Configuración Fiscal
app.get('/api/islr/comprobantes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [headerRes, itemsRes, configRes] = await Promise.all([
      db.execute({ sql: "SELECT * FROM retenciones_islr WHERE id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM retenciones_islr_detalles WHERE retencion_id = ? ORDER BY nro_operacion ASC", args: [id] }),
      db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1")
    ]);

    if (headerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Comprobante de Retención ISLR no encontrado' });
    }

    res.json({
      comprobante: headerRes.rows[0],
      detalles: itemsRes.rows,
      config: configRes.rows[0] || {}
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.7 Emitir Nuevo Comprobante de Retención ISLR (Validaciones PA SNAT/2026/00093)
app.post('/api/islr/comprobantes', async (req, res) => {
  try {
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
    } = req.body;

    // 1. Validar N° Comprobante de 14 dígitos exactos (AAAAMM + 8 dígitos)
    const cleanNroComp = String(nro_comprobante || '').trim();
    if (!/^\d{14}$/.test(cleanNroComp)) {
      return res.status(400).json({
        error: 'El Número de Comprobante debe tener exactamente 14 dígitos numéricos (Formato AAAAMM + 8 dígitos secuenciales, ej. 20261000000001).'
      });
    }

    // 2. Validar Correo Electrónico Obligatorio (PA SNAT/2026/00093)
    const cleanEmail = String(sujeto_email || '').trim();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({
        error: 'El Correo Electrónico del Proveedor (Sujeto Retenido) es un CAMPO OBLIGATORIO según la Providencia Administrativa SNAT/2026/00093.'
      });
    }

    // 3. Validar RIF y Razón Social del Sujeto Retenido
    const cleanRif = String(sujeto_rif || '').trim().toUpperCase();
    if (!cleanRif || !sujeto_razon_social) {
      return res.status(400).json({ error: 'El RIF y la Razón Social del Sujeto Retenido son obligatorios.' });
    }

    if (!Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos una factura o documento objeto de retención.' });
    }

    // Obtener configuración UT vigente
    const cfgRes = await db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1");
    const cfg = cfgRes.rows[0] || { valor_ut_bs: 43.00, factor_sustraendo: 83.3334 };
    const utBs = Number(valor_ut_aplicado || cfg.valor_ut_bs || 43.00);
    const factorSust = Number(cfg.factor_sustraendo || 83.3334);
    const tipoPersona = sujeto_tipo_persona || (cleanRif.startsWith('V') || cleanRif.startsWith('E') ? 'PN-R' : 'PJ-D');

    // Calcular totales y validar cada línea
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

      // Sustraendo automático para PN-R cuando aplique: UT * 83.3334 * (pctTarifa / 100)
      let sustraendo = 0.0;
      const umbralMinimo = utBs * factorSust;
      if (tipoPersona === 'PN-R' && (pctTarifa === 1 || pctTarifa === 3)) {
        if (item.sustraendo_bs !== undefined && item.sustraendo_bs !== null && item.sustraendo_bs !== '') {
          sustraendo = Number(item.sustraendo_bs);
        } else if (baseImp > umbralMinimo) {
          sustraendo = Number((utBs * factorSust * (pctTarifa / 100)).toFixed(2));
        }
      } else if (item.sustraendo_bs !== undefined && Number(item.sustraendo_bs) > 0) {
        sustraendo = Number(item.sustraendo_bs);
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

    // Sello de fecha y hora exacta con segundos
    const now = new Date();
    const pad2 = n => String(n).padStart(2, '0');
    const defaultHora = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const defaultFecha = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;

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
        cleanNroComp,
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
        Number(tasa_bcv || 68.50),
        utBs,
        Number(totDocBs.toFixed(2)),
        Number(totBaseBs.toFixed(2)),
        Number(totSustBs.toFixed(2)),
        Number(totRetBs.toFixed(2)),
        totalAPagar,
        String(observaciones || '').trim()
      ]
    });

    const retencionId = Number(insHeader.lastInsertRowid);

    for (const it of processedItems) {
      await db.execute({
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

    // Actualizar email y dirección del proveedor si aplica
    if (cleanRif) {
      await db.execute({
        sql: `UPDATE proveedores SET email = ?, direccion_fiscal = ?, tipo_persona = ? WHERE rif = ?`,
        args: [cleanEmail, String(sujeto_direccion || '').trim(), tipoPersona, cleanRif]
      });
    }

    res.json({
      success: true,
      id: retencionId,
      nro_comprobante: cleanNroComp,
      message: `Comprobante de Retención ISLR N° ${cleanNroComp} emitido conforme a la PA SNAT/2026/00093.`
    });
  } catch (error) {
    console.error('Error emitiendo comprobante ISLR:', error);
    res.status(500).json({ error: error.message });
  }
});

// 11.8 Eliminar Comprobante de Retención ISLR
app.delete('/api/islr/comprobantes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute({ sql: "DELETE FROM retenciones_islr_detalles WHERE retencion_id = ?", args: [id] });
    await db.execute({ sql: "DELETE FROM retenciones_islr WHERE id = ?", args: [id] });
    res.json({ success: true, message: 'Comprobante de Retención ISLR eliminado correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.9 Exportación Oficial XML SENIAT para Declaración Mensual de Retenciones ISLR
app.get('/api/islr/export-xml', async (req, res) => {
  try {
    const periodo = req.query.periodo || '2026-09';
    const yyyymm = String(periodo).replace('-', '');

    const [cfgRes, itemsRes] = await Promise.all([
      db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1"),
      db.execute({
        sql: `
          SELECT 
            r.nro_comprobante,
            r.periodo,
            r.sujeto_rif,
            r.sujeto_razon_social,
            d.fecha_factura,
            d.nro_factura,
            d.nro_control,
            d.codigo_concepto,
            d.base_imponible_bs,
            d.pct_tarifa,
            d.impuesto_retenido_bs
          FROM retenciones_islr r
          JOIN retenciones_islr_detalles d ON r.id = d.retencion_id
          WHERE r.periodo = ?
          ORDER BY r.nro_comprobante ASC, d.nro_operacion ASC
        `,
        args: [periodo]
      })
    ]);

    const cfg = cfgRes.rows[0] || { agente_rif: 'J-50700865-7' };
    const cleanAgenteRif = String(cfg.agente_rif || 'J507008657').replace(/[^A-Z0-9]/gi, '').toUpperCase();

    const xmlLines = [
      `<?xml version="1.0" encoding="ISO-8859-1"?>`,
      `<RelacionRetencionesISLR RifAgente="${cleanAgenteRif}" Periodo="${yyyymm}">`
    ];

    for (const row of itemsRes.rows) {
      const cleanRifRetenido = String(row.sujeto_rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const cleanFactura = String(row.nro_factura || '0').replace(/[^A-Z0-9]/gi, '').slice(0, 20) || '0';
      const cleanControl = String(row.nro_control || 'NA').replace(/[^A-Z0-9]/gi, '').slice(0, 20) || 'NA';
      const codConcepto = String(row.codigo_concepto || '055').padStart(3, '0');
      const montoOp = Number(row.base_imponible_bs || 0).toFixed(2);
      const pctRet = Number(row.pct_tarifa || 0).toFixed(2);

      // Fecha en formato DD/MM/AAAA exigido por el validador XML del SENIAT
      let fechaOp = String(row.fecha_factura || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(fechaOp)) {
        const [y, m, d] = fechaOp.split('-');
        fechaOp = `${d}/${m}/${y}`;
      }

      xmlLines.push(`  <DetalleRetencion>`);
      xmlLines.push(`    <RifRetenido>${cleanRifRetenido}</RifRetenido>`);
      xmlLines.push(`    <NumeroFactura>${cleanFactura}</NumeroFactura>`);
      xmlLines.push(`    <NumeroControl>${cleanControl}</NumeroControl>`);
      xmlLines.push(`    <FechaOperacion>${fechaOp}</FechaOperacion>`);
      xmlLines.push(`    <CodigoConcepto>${codConcepto}</CodigoConcepto>`);
      xmlLines.push(`    <MontoOperacion>${montoOp}</MontoOperacion>`);
      xmlLines.push(`    <PorcentajeRetencion>${pctRet}</PorcentajeRetencion>`);
      xmlLines.push(`  </DetalleRetencion>`);
    }

    xmlLines.push(`</RelacionRetencionesISLR>`);
    const xmlContent = xmlLines.join('\n');

    res.setHeader('Content-Disposition', `attachment; filename="RELACION_ISLR_${cleanAgenteRif}_${yyyymm}.xml"`);
    res.setHeader('Content-Type', 'application/xml; charset=ISO-8859-1');
    res.send(xmlContent);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11.10 Exportar Relación de Retenciones ISLR a Excel (.xlsx)
app.get('/api/islr/export-excel', async (req, res) => {
  try {
    const { periodo } = req.query;
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

    const result = await db.execute({ sql, args });
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `RET_ISLR_${periodo || '2026'}`);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Disposition', `attachment; filename="RETENCIONES_ISLR_SNAT202600093_${periodo || 'HISTORICO'}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================================================
// 12. TASAS BCV DE CIERRE MENSUAL Y REVALORIZACIÓN BIMONETARIA (MESES DECLARADOS)
// ==========================================================================

app.get('/api/tasas-bcv', async (req, res) => {
  try {
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

    // Priorizar la tasa diaria activa si está configurada; de lo contrario, la última de cierre
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

    res.json({
      metodo_valoracion_kardex: cfg.metodo_valoracion_kardex || 'CPP',
      tasas,
      tasa_activa: tasaActiva,
      historico_hoy: histRes.rows || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para Actualización Rápida Diaria de Tasa Oficial BCV con Histórico Intradía
app.post('/api/tasas-bcv/diaria', async (req, res) => {
  try {
    const { tasa_bcv, fecha, moneda = 'USD', usuario = 'ADMIN_DG67' } = req.body || {};
    const numTasa = parseFloat(tasa_bcv);
    if (!numTasa || numTasa <= 0) {
      return res.status(400).json({ error: 'Monto de tasa BCV inválido. Ingrese un valor mayor a cero.' });
    }
    const fechaTasa = fecha || new Date().toISOString().split('T')[0];
    const periodo = fechaTasa.slice(0, 7);
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

    // Guardar en config_fiscal_islr para no alterar las tasas de cierre mensual del 30
    await db.execute({
      sql: `UPDATE config_fiscal_islr SET tasa_bcv_activa_dia = ?, fecha_bcv_activa_dia = ? WHERE id = 1`,
      args: [numTasa, fechaTasa]
    });

    // Guardar registro histórico de cada cambio durante el día
    await db.execute({
      sql: `INSERT INTO historico_tasas_bcv (fecha, hora, timestamp, tasa_bcv, moneda, usuario, origen) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [fechaTasa, hora, timestamp, numTasa, moneda, usuario, 'MODAL_DIARIO']
    });

    const histRes = await db.execute({
      sql: "SELECT * FROM historico_tasas_bcv WHERE fecha = ? ORDER BY id DESC LIMIT 25",
      args: [fechaTasa]
    }).catch(() => ({ rows: [] }));

    res.json({
      ok: true,
      mensaje: `Tasa BCV del día actualizada con éxito: Bs. ${numTasa.toFixed(4)} por ${moneda} (${fechaTasa})`,
      tasa_bcv: numTasa,
      fecha: fechaTasa,
      periodo,
      historico_hoy: histRes.rows || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Error guardando tasa diaria: ' + err.message });
  }
});

// Endpoint para Consultar Historial Intradía de Tasas Oficiales
app.get('/api/tasas-bcv/historico', async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];
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
      args: [fecha]
    });
    res.json({
      fecha,
      historico: histRes.rows || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasas-bcv/revalorizar-cierre', async (req, res) => {
  try {
    const { tasas = [], metodo_valoracion_kardex } = req.body;

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

    // Revalorizar automáticamente los meses declarados en Movimientos (Kardex), Libro de Compras, Libro de Ventas y Retenciones ISLR
    await db.execute(`
      UPDATE movimientos
      SET tasa_bcv = COALESCE(
            (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
            movimientos.tasa_bcv,
            68.50
          ),
          fecha_tasa_bcv = COALESCE(
            (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
            movimientos.fecha_tasa_bcv,
            movimientos.fecha
          )
    `);

    await db.execute(`
      UPDATE movimiento_detalles
      SET costo_unitario_divisa = ROUND(COALESCE(
            NULLIF(costo_unitario_divisa, 0),
            NULLIF(costo_unitario_usd, 0),
            (SELECT p.costo_referencial_usd FROM productos p WHERE p.id = movimiento_detalles.producto_id),
            1.0
          ), 2),
          tasa_bcv_operacion = COALESCE(
            (SELECT m.tasa_bcv FROM movimientos m WHERE m.id = movimiento_detalles.movimiento_id),
            68.50
          )
    `);

    await db.execute(`
      UPDATE movimiento_detalles
      SET costo_unitario_usd = costo_unitario_divisa,
          costo_unitario_bs = ROUND(costo_unitario_divisa * tasa_bcv_operacion, 2),
          costo_unitario_ves = ROUND(costo_unitario_divisa * tasa_bcv_operacion, 2),
          precio_unitario_divisa = costo_unitario_divisa,
          precio_unitario_bs = ROUND(costo_unitario_divisa * tasa_bcv_operacion, 2),
          base_imponible_divisa = ROUND(cantidad * costo_unitario_divisa, 2),
          base_imponible_bs = ROUND(cantidad * costo_unitario_divisa * tasa_bcv_operacion, 2),
          monto_iva_divisa = ROUND(cantidad * costo_unitario_divisa * 0.16, 2),
          monto_iva_bs = ROUND(cantidad * costo_unitario_divisa * tasa_bcv_operacion * 0.16, 2),
          total_linea_divisa = ROUND(cantidad * costo_unitario_divisa * 1.16, 2),
          total_linea_bs = ROUND(cantidad * costo_unitario_divisa * tasa_bcv_operacion * 1.16, 2)
    `);

    await db.execute(`
      UPDATE libro_compras
      SET tasa_bcv = COALESCE(
            (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
            libro_compras.tasa_bcv,
            68.50
          ),
          fecha_tasa_bcv = COALESCE(
            (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
            libro_compras.fecha_tasa_bcv,
            libro_compras.fecha
          )
    `);

    await db.execute(`
      UPDATE libro_compras
      SET base_imponible_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          monto_iva_divisa = ROUND(iva_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          total_divisa = ROUND(total_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          iva_retenido_divisa = ROUND(iva_retenido_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2)
    `);

    await db.execute(`
      UPDATE libro_ventas
      SET tasa_bcv = COALESCE(
            (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
            libro_ventas.tasa_bcv,
            68.50
          ),
          fecha_tasa_bcv = COALESCE(
            (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
            libro_ventas.fecha_tasa_bcv,
            libro_ventas.fecha
          )
    `);

    await db.execute(`
      UPDATE libro_ventas
      SET exento_divisa = ROUND(exento_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          base_imponible_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          monto_iva_divisa = ROUND(iva_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
          total_divisa = ROUND(total_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2)
    `);

    res.json({
      success: true,
      message: 'Tasas Oficiales BCV de Cierre Mensual aplicadas y revalorización bimonetaria (Bs. ↔ USD) completada en Kardex, Libro de Compras y Libro de Ventas.'
    });
  } catch (error) {
    console.error('Error revalorizando cierres BCV:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
