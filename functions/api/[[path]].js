import { createClient } from '@libsql/client/web';

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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
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

    // ----------------------------------------------------
    // PRODUCTOS & KARDEX
    // ----------------------------------------------------
    if (path === '/api/productos' && method === 'GET') {
      const q = url.searchParams.get('q');
      const cat = url.searchParams.get('categoria');
      const alm = url.searchParams.get('almacen');
      const est = url.searchParams.get('estado');
      const limit = parseInt(url.searchParams.get('limit') || '1000', 10);

      let sql = `
        SELECT producto_id, codigo, descripcion, unidad_medida, 
               categoria, almacen, stock_minimo, costo_referencial_usd, 
               stock_actual, valor_total_usd, estado_stock
        FROM vista_inventario_actual
        WHERE 1=1
      `;
      const args = [];

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

      const [res, cfgRes] = await Promise.all([
        db.execute({ sql, args }),
        db.execute("SELECT tasa_bcv_activa_dia, fecha_bcv_activa_dia FROM config_fiscal_islr WHERE id = 1")
      ]);

      const tasa = Number(cfgRes.rows[0]?.tasa_bcv_activa_dia || 889.26);
      const enriched = res.rows.map(r => {
        const cUsd = Number(r.costo_referencial_usd || 0);
        const vUsd = Number(r.valor_total_usd || 0);
        return {
          ...r,
          tasa_bcv_aplicada: tasa,
          costo_unitario_bs: Number((cUsd * tasa).toFixed(2)),
          valor_total_bs: Number((vUsd * tasa).toFixed(2))
        };
      });

      return jsonResponse(enriched);
    }

    // ----------------------------------------------------
    // TASAS BCV
    // ----------------------------------------------------
    if (path === '/api/tasas-bcv' && method === 'GET') {
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

      return jsonResponse({
        metodo_valoracion_kardex: cfg.metodo_valoracion_kardex || 'CPP',
        tasas,
        tasa_activa: tasaActiva
      });
    }

    if (path === '/api/tasas-bcv/diaria' && method === 'POST') {
      const b = await request.json();
      const numTasa = parseFloat(b.tasa_bcv);
      if (!numTasa || numTasa <= 0) return jsonResponse({ error: 'Monto de tasa BCV inválido' }, 400);

      const fechaTasa = b.fecha || new Date().toISOString().split('T')[0];
      await db.execute({
        sql: `UPDATE config_fiscal_islr SET tasa_bcv_activa_dia = ?, fecha_bcv_activa_dia = ? WHERE id = 1`,
        args: [numTasa, fechaTasa]
      });

      return jsonResponse({
        ok: true,
        mensaje: `Tasa BCV actualizada: Bs. ${numTasa.toFixed(4)} (${fechaTasa})`,
        tasa_bcv: numTasa,
        fecha: fechaTasa
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
    // CONTROL FISCAL & SENIAT
    // ----------------------------------------------------
    if (path === '/api/fiscal/libro-compras' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `SELECT lc.*, p.razon_social as proveedor_registrado_nombre FROM libro_compras lc LEFT JOIN proveedores p ON lc.proveedor_id = p.id WHERE 1=1`;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND lc.periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY lc.periodo ASC, lc.fecha ASC, lc.id ASC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/fiscal/libro-ventas' && method === 'GET') {
      const periodo = url.searchParams.get('periodo');
      let sql = `SELECT * FROM libro_ventas WHERE 1=1`;
      const args = [];
      if (periodo && periodo !== 'TODOS') {
        sql += ` AND periodo = ?`;
        args.push(periodo);
      }
      sql += ` ORDER BY periodo ASC, fecha ASC, id ASC`;
      const res = await db.execute({ sql, args });
      return jsonResponse(res.rows);
    }

    if (path === '/api/fiscal/declaraciones-iva' && method === 'GET') {
      const res = await db.execute("SELECT * FROM declaraciones_iva ORDER BY periodo ASC");
      return jsonResponse(res.rows);
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
