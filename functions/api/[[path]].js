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

const TURSO_URL = 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

const AUTH_SALT = 'DG67_UCG_SALT_2026';

function getDb() {
  return createClient({
    url: TURSO_URL,
    authToken: TURSO_AUTH_TOKEN
  });
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password + AUTH_SALT);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    console.error('Error verificando estatus de período declarado:', e);
  }
  return false;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders
    }
  });
}

export async function onRequest(context) {
  const { request } = context;
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const db = getDb();

  try {
    // ----------------------------------------------------
    // AUTHENTICATION & HEALTH
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
      return jsonResponse({ ok: true, active: true });
    }

    if (path === '/api/auth/login' && method === 'POST') {
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
        return jsonResponse({ error: 'Usuario o contraseña incorrectos. Verifique sus credenciales.' }, 401);
      }

      const user = result.rows[0];
      if (!user.activo) {
        return jsonResponse({ error: 'Cuenta de usuario inactiva. Comuníquese con Unión Contable Global.' }, 403);
      }

      await db.execute({
        sql: "UPDATE usuarios SET ultimo_acceso = datetime('now') WHERE id = ?",
        args: [user.id]
      });

      const tokenBytes = new Uint8Array(24);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

      return jsonResponse({
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
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      return jsonResponse({
        ok: true,
        mensaje: 'Sesión finalizada y destruida con éxito.'
      });
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
            ROUND(COALESCE(SUM(COALESCE(NULLIF(md.total_linea_divisa, 0), md.cantidad * NULLIF(p.costo_referencial_usd, 0), md.cantidad * 2.5)), 0), 2) as total_ventas_usd,
            ROUND(COALESCE(SUM(COALESCE(NULLIF(md.total_linea_bs, 0), NULLIF(md.total_linea_divisa, 0) * 889.58, md.cantidad * COALESCE(NULLIF(p.costo_referencial_usd, 0), 2.5) * 889.58)), 0), 2) as total_ventas_bs
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
      // Depuración de registro residual obsoleto de la carga inicial (ID 32 J-000256862-3) si no tiene facturas ni movimientos
      await db.execute(`
        DELETE FROM proveedores 
        WHERE id = 32 
          AND rif = 'J-000256862-3' 
          AND NOT EXISTS (SELECT 1 FROM libro_compras WHERE proveedor_id = 32)
          AND NOT EXISTS (SELECT 1 FROM movimientos WHERE proveedor_id = 32)
      `).catch(() => {});

      const res = await db.execute(`
        SELECT 
          p.id, p.rif, p.razon_social,
          COALESCE(p.tipo_servicio, 'MERCANCIA_REPUESTOS') as tipo_servicio,
          COALESCE(p.aplica_inventario, 1) as aplica_inventario,
          COALESCE(p.porcentaje_retencion, 75.0) as porcentaje_retencion,
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
      return jsonResponse(res.rows);
    }

    if (path === '/api/proveedores' && method === 'POST') {
      const b = await request.json();
      const cleanRif = String(b.rif || '').trim().toUpperCase();
      const cleanRazon = String(b.razon_social || '').trim();
      if (!cleanRif || !cleanRazon) return jsonResponse({ error: 'RIF y Razón Social son requeridos' }, 400);

      const ins = await db.execute({
        sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [
          cleanRif, cleanRazon, b.tipo_servicio || 'MERCANCIA_REPUESTOS',
          b.aplica_inventario ? 1 : 0, Number(b.porcentaje_retencion) || 75.0,
          b.telefono || null, b.email || null,
          b.tipo_persona || (cleanRif.startsWith('V') || cleanRif.startsWith('E') ? 'PN-R' : 'PJ-D'),
          b.direccion_fiscal || '', b.codigo_concepto_islr || '055'
        ]
      });
      return jsonResponse({ success: true, id: ins.rows[0]?.id, message: 'Proveedor creado' });
    }

    if (path.startsWith('/api/proveedores/') && path.endsWith('/clasificacion') && method === 'PATCH') {
      const id = path.replace('/api/proveedores/', '').replace('/clasificacion', '');
      const b = await request.json();
      const { tipo_servicio, aplica_inventario } = b;
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

      return jsonResponse({
        success: true,
        message: `Proveedor ID #${id} clasificado como ${aplicaInvInt ? 'Proveedor de Mercancía' : 'Gasto/Servicio'}`
      });
    }

    if (path.startsWith('/api/proveedores/') && !path.endsWith('/clasificacion') && method === 'PUT') {
      const id = path.replace('/api/proveedores/', '');
      const b = await request.json();
      const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email, tipo_persona, direccion_fiscal, codigo_concepto_islr } = b;
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

      return jsonResponse({ success: true, message: 'Proveedor actualizado' });
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
        args.push(fechaCorte);

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
          SELECT producto_id, codigo, descripcion, unidad_medida, 
                 categoria, almacen, stock_minimo, costo_referencial_usd, 
                 stock_actual, valor_total_usd, estado_stock
          FROM vista_inventario_actual
          WHERE 1=1
        `;

        if (q) {
          sql += ` AND (codigo LIKE ? OR descripcion LIKE ?)`;
          args.push(`%${q}%`, `%${q}%`);
        }
        if (cat && cat !== 'TODAS') {
          sql += ` AND categoria = ?`;
          args.push(cat);
        }
        if (alm && alm !== 'TODOS') {
          sql += ` AND almacen = ?`;
          args.push(alm);
        }
        if (est && est !== 'TODOS') {
          sql += ` AND estado_stock = ?`;
          args.push(est);
        }

        sql += ` ORDER BY codigo ASC LIMIT ?`;
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

      const [prodRes, cfgRes] = await Promise.all([
        db.execute({
          sql: `SELECT * FROM vista_inventario_actual WHERE UPPER(codigo) = UPPER(?)`,
          args: [codigo]
        }),
        db.execute("SELECT metodo_valoracion_kardex FROM config_fiscal_islr WHERE id = 1")
      ]);

      if (prodRes.rows.length === 0) {
        return jsonResponse({ error: 'Producto no encontrado' }, 404);
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

      let balance = 0;
      let cppUsd = refUsd;
      let cppVes = Number((refUsd * 52.02).toFixed(2));
      let valTotalUsd = 0;
      let valTotalVes = 0;
      const fifoQueue = [];

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

      const actaRes = await db.execute({
        sql: "SELECT * FROM actas_toma_fisica WHERE periodo = ? LIMIT 1",
        args: [periodo]
      });
      if (actaRes.rows.length === 0) {
        const numActa = `ACTA-INV-${periodo.replace('-', '')}-01`;
        await db.execute({
          sql: `INSERT INTO actas_toma_fisica (periodo, numero_acta, estatus, tasa_bcv, auditor_tienda, gerente_dg67, contador_ucg, updated_at)
                VALUES (?, ?, 'ABIERTA', 889.58, 'Personal de Almacén / Auditor DG 67', 'Gerencia General DG 67', 'Lcda. Liliana Chacón • CPC (Unión Contable Global)', datetime('now', 'localtime'))
                ON CONFLICT(periodo) DO NOTHING`,
          args: [periodo, numActa]
        }).catch(() => {});

        return jsonResponse({
          periodo,
          estatus: 'ABIERTA',
          numero_acta: numActa,
          tasa_bcv: 889.58,
          auditor_tienda: 'Personal de Almacén / Auditor DG 67',
          gerente_dg67: 'Gerencia General DG 67',
          contador_ucg: 'Lcda. Liliana Chacón • CPC (Unión Contable Global)',
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
        tasa_bcv: Number(a.tasa_bcv || 889.58)
      });
    }

    if (path === '/api/auditoria/toma-fisica/apertura' && method === 'POST') {
      const body = await request.json();
      const {
        periodo = '2026-10',
        numero_acta = 'ACTA-INV-202610-01',
        tasa_bcv = 889.58,
        auditor_tienda = 'Personal de Almacén / Auditor DG 67',
        gerente_dg67 = 'Gerencia General DG 67',
        contador_ucg = 'Lcda. Liliana Chacón • CPC (Unión Contable Global)'
      } = body || {};

      await db.execute({
        sql: `INSERT INTO actas_toma_fisica (periodo, numero_acta, estatus, tasa_bcv, auditor_tienda, gerente_dg67, contador_ucg, updated_at)
              VALUES (?, ?, 'ABIERTA', ?, ?, ?, ?, datetime('now', 'localtime'))
              ON CONFLICT(periodo) DO UPDATE SET
                numero_acta = excluded.numero_acta,
                tasa_bcv = excluded.tasa_bcv,
                auditor_tienda = excluded.auditor_tienda,
                gerente_dg67 = excluded.gerente_dg67,
                contador_ucg = excluded.contador_ucg,
                updated_at = datetime('now', 'localtime')`,
        args: [periodo, numero_acta, tasa_bcv, auditor_tienda, gerente_dg67, contador_ucg]
      });

      return jsonResponse({
        success: true,
        periodo,
        estatus: 'ABIERTA',
        numero_acta
      });
    }

    if (path === '/api/auditoria/toma-fisica/cerrar' && method === 'POST') {
      const body = await request.json();
      const {
        periodo = '2026-10',
        numero_acta = 'ACTA-INV-202610-01',
        usuario = 'ADMIN_DG67',
        fecha_cierre = new Date().toISOString(),
        auditor_tienda = 'Personal de Almacén DG 67',
        gerente_dg67 = 'Gerencia General Inversiones DG 67, C.A.',
        contador_ucg = 'Lcda. Liliana Chacón • CPC (Unión Contable Global)',
        tasa_bcv = 889.58
      } = body || {};

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

      return jsonResponse({
        success: true,
        periodo,
        numero_acta,
        estatus: 'CERRADA',
        fecha_cierre,
        usuario_cierre: usuario,
        mensaje: `✅ Toma Física del período ${periodo} formalmente cerrada y sellada.`
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
      `);

      await db.execute(`
        UPDATE libro_compras
        SET tasa_bcv = COALESCE(
              (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
              libro_compras.tasa_bcv,
              889.58
            )
      `);

      await db.execute(`
        UPDATE libro_ventas
        SET tasa_bcv = COALESCE(
              (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
              libro_ventas.tasa_bcv,
              889.58
            )
      `);

      return jsonResponse({
        success: true,
        message: 'Revalorización de cierres ejecutada exitosamente con doble expresión monetaria (Bs./USD).'
      });
    }

    // ----------------------------------------------------
    // MOVIMIENTOS (HISTORIAL & REGISTRO)
    // ----------------------------------------------------
    if (path === '/api/movimientos' && method === 'GET') {
      const tipo = url.searchParams.get('tipo');
      const limit = parseInt(url.searchParams.get('limit') || '150', 10);

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
          COALESCE(m.tasa_bcv, 68.50) as tasa_bcv,
          m.observaciones,
          COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as proveedor_nombre,
          COALESCE(pr.rif, '-') as proveedor_rif,
          COUNT(md.id) as total_items,
          COALESCE(SUM(md.cantidad), 0) as total_unidades,
          ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_usd, 0), p.costo_referencial_usd)), 0), 2) as total_usd,
          ROUND(COALESCE(SUM(md.cantidad * COALESCE(NULLIF(md.costo_unitario_ves, 0), p.costo_referencial_usd * COALESCE(m.tasa_bcv, 68.50))), 0), 2) as total_ves
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
          sql: `SELECT m.*, COALESCE(pr.razon_social, 'N/A') as proveedor_nombre, COALESCE(pr.rif, 'N/A') as proveedor_rif
                FROM movimientos m LEFT JOIN proveedores pr ON m.proveedor_id = pr.id WHERE m.id = ?`,
          args: [id]
        }),
        db.execute({
          sql: `SELECT md.*, p.codigo, p.descripcion, p.unidad_medida
                FROM movimiento_detalles md JOIN productos p ON md.producto_id = p.id WHERE md.movimiento_id = ?`,
          args: [id]
        })
      ]);
      return jsonResponse({
        header: hdr.rows[0] || null,
        detalles: dtl.rows
      });
    }

    // ----------------------------------------------------
    // REGISTRAR MOVIMIENTO (DG67: SALIDAS / ENTRADAS CON TRAZABILIDAD Y CRUCE)
    // ----------------------------------------------------
    if (path === '/api/movimientos' && method === 'POST') {
      const body = await request.json();
      const {
        tipo, subtipo, fecha, numero_documento, nro_control, usuario_responsable,
        documento_afectado, tasa_bcv, proveedor_id, observaciones, items
      } = body;

      if (!tipo || !['ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE'].includes(tipo)) {
        return jsonResponse({ error: 'Tipo de movimiento inválido' }, 400);
      }
      if (!fecha) {
        return jsonResponse({ error: 'La fecha es obligatoria (Art. 177 RISLR)' }, 400);
      }
      if (!numero_documento || String(numero_documento).trim() === '') {
        return jsonResponse({ error: 'El número de documento es obligatorio' }, 400);
      }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return jsonResponse({ error: 'Debe incluir al menos un producto en el movimiento' }, 400);
      }

      const subtipoNorm = subtipo || (tipo === 'ENTRADA_COMPRA' ? 'COMPRA_NACIONAL' : (tipo === 'SALIDA_VENTA' ? 'VENTA' : 'AJUSTE'));
      const usuarioNorm = (usuario_responsable && String(usuario_responsable).trim()) || 'CAJA_DG67';
      const periodoMov = String(fecha).slice(0, 7);

      if (await isPeriodoDeclarado(periodoMov, db)) {
        return jsonResponse({
          error: `⛔ Bloqueo Fiscal de Seguridad: El período ${periodoMov} ya ha sido DECLARADO formalmente ante el SENIAT. No se permiten nuevos asientos ni alteraciones en períodos fiscales cerrados.`
        }, 403);
      }

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodoMov] });
      const tasaDefaultMes = Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const tasaNum = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : tasaDefaultMes;
      const fechaTasaMes = body.fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
      const ctrlNorm = (nro_control && String(nro_control).trim()) || (tipo === 'ENTRADA_COMPRA' ? '00-S/CTRL' : 'ZOA0000176');

      let numFacturaNum = null;
      const matchNum = String(numero_documento).match(/(\d+)/);
      if (matchNum) numFacturaNum = parseInt(matchNum[1], 10);

      // VALIDACIÓN ANTI-DUPLICADOS PARA ENTRADAS DE ALMACÉN
      if (tipo === 'ENTRADA_COMPRA' && proveedor_id) {
        const dupEnt = await verificarDuplicadoEntradaAlmacen(proveedor_id, numero_documento, null, db);
        if (dupEnt.duplicado) {
          return jsonResponse({
            error: dupEnt.mensaje,
            duplicado: true,
            detalle: dupEnt
          }, 409);
        }
      }

      const headerResult = await db.execute({
        sql: `INSERT INTO movimientos 
              (tipo, subtipo, fecha, numero_documento, numero_factura_numerico, nro_control, usuario_responsable,
               documento_afectado, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, proveedor_id, observaciones,
               estatus_conciliacion)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CPP', ?, ?, 'PENDIENTE_UCG')
              RETURNING id`,
        args: [
          tipo, subtipoNorm, fecha, String(numero_documento).trim(), numFacturaNum, ctrlNorm, usuarioNorm,
          documento_afectado || '', tasaNum, fechaTasaMes, body.moneda_operacion || 'USD',
          proveedor_id ? parseInt(proveedor_id, 10) : null, observaciones || ''
        ]
      });

      const movimientoId = Number(headerResult.rows[0]?.id || headerResult.lastInsertRowid);

      const detailStatements = [];
      for (const it of items) {
        const pid = parseInt(it.producto_id, 10);
        const qty = parseFloat(it.cantidad) || 1;
        const tasaItem = Number(it.tasa_bcv_operacion || tasaNum) > 0 ? Number(it.tasa_bcv_operacion || tasaNum) : tasaNum;

        let cDivisa = parseFloat(it.costo_unitario_divisa || it.costo_unitario_usd || 0);
        let cBs = parseFloat(it.costo_unitario_bs || it.costo_unitario_ves || 0);
        if (cDivisa <= 0 && cBs > 0) cDivisa = Number((cBs / tasaItem).toFixed(2));
        if (cDivisa <= 0) {
          const pRes = await db.execute({ sql: "SELECT costo_referencial_usd FROM productos WHERE id = ?", args: [pid] });
          cDivisa = Number(pRes.rows[0]?.costo_referencial_usd || 0);
        }
        if (cBs <= 0) cBs = Number((cDivisa * tasaItem).toFixed(2));

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
      } else if (tipo === 'ENTRADA_COMPRA') {
        let lcId = body.libro_compras_id || null;
        if (!lcId && numFacturaNum) {
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

      return jsonResponse({
        success: true,
        message: `Movimiento (${subtipoNorm}) registrado exitosamente con doble expresión Bs./USD`,
        movimientoId,
        itemsCount: items.length,
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
      let sql = `
        SELECT 
          lc.*, 
          p.razon_social as proveedor_registrado_nombre,
          ri.id as retencion_islr_id,
          ri.nro_comprobante as comprobante_islr_emitido
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
      sql += ` ORDER BY lc.fecha ASC, lc.nro_operacion ASC, lc.id ASC`;
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

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
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
      const numZ = String(numero_reporte_z || '').trim();
      const serial = String(serial_impresora || 'Z0A0000176').trim();
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

      return jsonResponse({
        success: true,
        id: zId,
        message: 'Reporte Z guardado con éxito en Libro de Ventas (Conciliación Automática)',
        conciliacion: resultadoCruce
      });
    }

    if ((path.startsWith('/api/fiscal/libro-ventas/') && (method === 'PUT' || method === 'POST')) || (path === '/api/fiscal/libro-ventas' && method === 'PUT')) {
      const body = await request.json();
      const zId = parseInt(path === '/api/fiscal/libro-ventas' ? body.id : path.split('/').pop(), 10);
      if (!zId) return jsonResponse({ error: 'ID de Reporte Z inválido para actualización' }, 400);

      const existingZ = await db.execute({ sql: "SELECT periodo FROM libro_ventas WHERE id = ?", args: [zId] });
      const targetPeriodo = body.periodo || existingZ.rows[0]?.periodo;
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
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
        return jsonResponse({ error: 'Faltan campos requeridos (Período y Fecha)' }, 400);
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

      const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
      const tasaOp = Number(tasa_bcv) > 0 ? Number(tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
      const fechaTasaOp = fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;
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

      return jsonResponse({
        success: true,
        id: zId,
        message: 'Reporte Z actualizado con éxito en el Libro de Ventas (Conciliación Recalculada)',
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
      await db.execute({ sql: "DELETE FROM libro_ventas WHERE id = ?", args: [zId] });
      return jsonResponse({ success: true, message: 'Registro de venta eliminado del Libro de Ventas' });
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

      const ali = Number(alicuota) || 0.16;
      const baseBs = Number(base_imponible_bs) || 0.0;
      const ivaBs = Number(iva_bs) || Number((baseBs * ali).toFixed(2));
      const totBs = Number(total_bs) || Number((baseBs + ivaBs).toFixed(2));
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
                  VALUES (?, ?, ?, ?, 75.0) RETURNING id`,
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
        const numClean = String(nro_factura).replace(/\D/g, '');
        const numInt = numClean ? parseInt(numClean, 10) : null;
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
        : Number((ivaBs * 0.75).toFixed(2));
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
        return jsonResponse({ error: 'Se requiere una lista de facturas a asentar' }, 400);
      }

      const resultados = [];
      let insertadas = 0;
      let duplicadas = 0;
      let errores = 0;

      for (const f of facturas) {
        try {
          const { periodo, fecha, rif, razon_social, nro_factura, nro_control } = f;
          if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
            resultados.push({ nro_factura: nro_factura || 'S/N', success: false, error: 'Faltan campos obligatorios' });
            errores++;
            continue;
          }

          if (await isPeriodoDeclarado(periodo, db)) {
            resultados.push({ nro_factura, success: false, error: `Período ${periodo} ya declarado y cerrado` });
            errores++;
            continue;
          }

          const cleanRif = String(rif).trim().toUpperCase();
          const cleanRazon = String(razon_social).trim();

          const checkDup = await verificarDuplicadoLibroCompras(cleanRif, nro_factura, nro_control, null, db);
          if (checkDup.duplicado) {
            resultados.push({ nro_factura, success: false, duplicado: true, error: checkDup.mensaje });
            duplicadas++;
            continue;
          }

          const tasaPerRes = await db.execute({ sql: "SELECT tasa_bcv, fecha_cierre FROM tasas_bcv_periodo WHERE periodo = ?", args: [periodo] });
          const tasaOp = Number(f.tasa_bcv) > 0 ? Number(f.tasa_bcv) : Number(tasaPerRes.rows[0]?.tasa_bcv || 889.58);
          const fechaTasaOp = f.fecha_tasa_bcv || tasaPerRes.rows[0]?.fecha_cierre || fecha;

          const ali = Number(f.alicuota) || 0.16;
          const baseBs = Number(f.base_imponible_bs) || 0.0;
          const ivaBs = Number(f.iva_bs) || Number((baseBs * ali).toFixed(2));
          const totBs = Number(f.total_bs) || Number((baseBs + ivaBs).toFixed(2));
          const baseDiv = Number((baseBs / tasaOp).toFixed(2));
          const ivaDiv = Number((ivaBs / tasaOp).toFixed(2));
          const totDiv = Number((totBs / tasaOp).toFixed(2));
          const esMercancia = (f.aplica_inventario === 1 || f.aplica_inventario === true || f.aplica_inventario === '1');

          const provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE rif = ? LIMIT 1", args: [cleanRif] });
          let provId = provRes.rows[0]?.id || null;
          if (!provId) {
            try {
              const newProv = await db.execute({
                sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion)
                      VALUES (?, ?, ?, ?, 75.0) RETURNING id`,
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
            : Number((ivaBs * 0.75).toFixed(2));
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
          resultados.push({
            id: lcId,
            nro_factura,
            nro_operacion: nextOp,
            success: true,
            mensaje: `Factura ${nro_factura} asentada con éxito (Op #${nextOp})`
          });
        } catch (err) {
          errores++;
          resultados.push({ nro_factura: f.nro_factura || 'S/N', success: false, error: err.message });
        }
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
      if (await isPeriodoDeclarado(targetPeriodo, db)) {
        return jsonResponse({
          error: `El período fiscal ${targetPeriodo} ya se encuentra DECLARADO y CERRADO ante el SENIAT. No se permite modificar este comprobante.`
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
        return jsonResponse({ error: 'Faltan campos obligatorios para el Libro de Compras' }, 400);
      }

      const cleanRif = String(rif).trim().toUpperCase();
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

      const ali = Number(alicuota) || 0.16;
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

      const provRes = await db.execute({ sql: "SELECT id FROM proveedores WHERE rif = ? LIMIT 1", args: [cleanRif] });
      const provId = provRes.rows[0]?.id || null;

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

      return jsonResponse({
        success: true,
        id: compId,
        message: 'Factura actualizada con éxito en Libro de Compras (Doble Expresión Bs./USD)'
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
      return jsonResponse({ success: true, message: 'Factura eliminada del Libro de Compras' });
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
        sql: `UPDATE declaraciones_iva 
              SET estatus = ?,
                  ventas_base_bs = ?,
                  debito_fiscal_bs = ?,
                  compras_base_bs = ?,
                  credito_fiscal_bs = ?,
                  iva_retenido_bs = 0,
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
          excAnt,
          excSig,
          aPagar,
          totalFac,
          totalDias,
          periodo
        ]
      });

      return jsonResponse({
        success: true,
        periodo,
        estatus: nuevoEstatus,
        mensaje: nuevoEstatus === 'DECLARADO'
          ? `Período fiscal ${periodo} marcado exitosamente como DECLARADO y CERRADO ante el SENIAT. Libros bloqueados en modo de sólo lectura.`
          : `Período fiscal ${periodo} reabierto en estado EN_PROCESO.`
      });
    }

    if (path === '/api/fiscal/declaraciones-iva' && method === 'GET') {
      const res = await db.execute("SELECT * FROM declaraciones_iva ORDER BY periodo ASC");
      const rows = res.rows.map(r => ({ ...r }));

      // Para cualquier período abierto (EN_PROCESO o 2026-10), autocalcular dinámicamente con los libros
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.estatus === 'EN_PROCESO' || row.periodo === '2026-10') {
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
      await db.execute(`
        UPDATE config_fiscal_islr 
        SET agente_email = 'dg67contable@gmail.com',
            aplica_imprenta_digital = 0
        WHERE id = 1
      `).catch(() => {});
      await db.execute(`
        UPDATE empresas 
        SET email = 'dg67contable@gmail.com' 
        WHERE id = 1 AND (email IS NULL OR email LIKE '%inversionesdg67.com.ve%')
      `).catch(() => {});

      const [cfgRes, empRes] = await Promise.all([
        db.execute("SELECT * FROM config_fiscal_islr WHERE id = 1"),
        db.execute("SELECT * FROM empresas WHERE id = 1")
      ]);
      return jsonResponse({
        config: cfgRes.rows[0] || {},
        empresa: empRes.rows[0] || {}
      });
    }

    if (path === '/api/islr/conceptos' && method === 'GET') {
      const res = await db.execute("SELECT * FROM conceptos_retencion_islr WHERE activo = 1 ORDER BY codigo ASC");
      return jsonResponse(res.rows);
    }

    if (path === '/api/islr/comprobantes' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `SELECT * FROM retenciones_islr WHERE 1=1`;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY periodo DESC, id DESC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/islr/proximo-numero' && method === 'GET') {
      const periodo = url.searchParams.get('periodo') || '2026-10';
      const libroCompraId = url.searchParams.get('libro_compra_id');
      const nroFactura = url.searchParams.get('nro_factura');
      const rif = url.searchParams.get('rif');

      // Si se consulta para una factura específica que ya tiene comprobante emitido, preservar e informar dicho comprobante
      if (libroCompraId || (nroFactura && rif)) {
        let findSql = `
          SELECT ri.id, ri.nro_comprobante, ri.periodo 
          FROM retenciones_islr ri
          JOIN retenciones_islr_detalles rid ON ri.id = rid.retencion_id
          WHERE 1=1
        `;
        const findArgs = [];
        if (libroCompraId) {
          findSql += ` AND rid.libro_compra_id = ?`;
          findArgs.push(libroCompraId);
        } else {
          findSql += ` AND rid.nro_factura = ? AND ri.sujeto_rif = ?`;
          findArgs.push(nroFactura, rif);
        }
        findSql += ` ORDER BY ri.id ASC LIMIT 1`;

        const existingRes = await db.execute({ sql: findSql, args: findArgs }).catch(() => ({ rows: [] }));
        if (existingRes.rows.length > 0) {
          const ex = existingRes.rows[0];
          return jsonResponse({
            periodo: ex.periodo || periodo,
            nro_comprobante: ex.nro_comprobante,
            retencion_id: ex.id,
            es_existente: true
          });
        }
      }

      const yyyymm = String(periodo).replace('-', '').slice(0, 6);

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
      return jsonResponse({ periodo, nro_comprobante: nroComprobante, es_existente: false });
    }

    if (path === '/api/islr/facturas-disponibles' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      const rif = url.searchParams.get('rif');
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
      return jsonResponse(result.rows);
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
      const tipoPersona = sujeto_tipo_persona || (cleanRif.startsWith('V') || cleanRif.startsWith('E') ? 'PN-R' : 'PJ-D');

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

      if (!retencionId && cleanNroComp) {
        const existRes = await db.execute({
          sql: "SELECT * FROM retenciones_islr WHERE nro_comprobante = ? LIMIT 1",
          args: [cleanNroComp]
        }).catch(() => ({ rows: [] }));
        if (existRes.rows.length > 0) {
          existingComp = existRes.rows[0];
          retencionId = Number(existingComp.id);
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

        // Limpiar detalles viejos para insertar los nuevos
        await db.execute({
          sql: "DELETE FROM retenciones_islr_detalles WHERE retencion_id = ?",
          args: [retencionId]
        });
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

      if (cleanRif) {
        await db.execute({
          sql: `UPDATE proveedores SET email = ?, direccion_fiscal = ?, tipo_persona = ? WHERE rif = ?`,
          args: [cleanEmail, String(sujeto_direccion || '').trim(), tipoPersona, cleanRif]
        });
      }

      return jsonResponse({
        success: true,
        id: retencionId,
        nro_comprobante: cleanNroComp,
        message: `Comprobante de Retención ISLR N° ${cleanNroComp} emitido conforme a la PA SNAT/2026/00093.`
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

    if (path === '/api/reportes/mes-a-mes' && method === 'GET') {
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
      return jsonResponse(rawMovs.rows);
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
          COALESCE(factura_desde, '') as "DESDE",
          COALESCE(factura_hasta, '') as "HASTA",
          cantidad_comprobantes as "CANT_COMPROBANTES",
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
      const tasaCorte = Number(tasaRes.rows[0]?.tasa_bcv || 889.58);

      const result = await db.execute(`
        SELECT 
          p.codigo as "CODIGO",
          p.descripcion as "DESCRIPCION",
          p.unidad_medida as "UND",
          COALESCE(c.nombre, 'GENERAL') as "CATEGORIA",
          COALESCE(a.nombre, 'PRINCIPAL') as "ALMACEN",
          p.stock_minimo as "STOCK_MIN",
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'ENTRADA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%POSITIVO%' OR m.subtipo LIKE '%ENTRADA%' OR m.subtipo LIKE '%SOBRANTE%')) 
                 THEN md.cantidad 
            WHEN m.tipo IN ('SALIDA_VENTA', 'SALIDA_AJUSTE')
                 OR (m.tipo = 'AJUSTE' AND (m.subtipo LIKE '%NEGATIVO%' OR m.subtipo LIKE '%SALIDA%' OR m.subtipo LIKE '%MERMA%')) 
                 THEN -md.cantidad 
            ELSE 0 
          END), 0), 2) as "STOCK_ACTUAL",
          p.costo_referencial_usd as "COSTO_REF_USD"
        FROM productos p
        LEFT JOIN categorias c ON p.categoria_id = c.id
        LEFT JOIN almacenes a ON p.almacen_id = a.id
        LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
        LEFT JOIN movimientos m ON md.movimiento_id = m.id
        GROUP BY p.id
        ORDER BY p.codigo ASC
      `);

      const headers = Object.keys(result.rows[0] || {});
      const csvRows = [headers.join(';')];
      for (const r of result.rows) {
        csvRows.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'));
      }
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      return new Response(csvContent, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="INVENTARIO_DG67_${fecha_corte || 'OCTUBRE_2026'}.csv"`,
          ...corsHeaders
        }
      });
    }

    // Default Fallback
    return jsonResponse({ error: `Ruta API no implementada o no encontrada: ${method} ${path}` }, 404);

  } catch (err) {
    console.error('Edge Function Error:', err);
    return jsonResponse({
      error: 'Error interno en el servidor de borde (Cloudflare + Turso): ' + err.message,
      path
    }, 500);
  }
}
