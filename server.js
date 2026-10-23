import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import xlsxPkg from 'xlsx';
const XLSX = xlsxPkg.utils ? xlsxPkg : (xlsxPkg.default || xlsxPkg);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Connect to Turso Cloud (fallback to local SQLite if env not found)
const dbUrl = process.env.TURSO_DATABASE_URL || 'file:inventario_dg67.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log(`Connecting to Turso: ${dbUrl}`);

const db = createClient({
  url: dbUrl,
  authToken: authToken
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

// 2. Dashboard KPIs & Summaries
app.get('/api/dashboard', async (req, res) => {
  try {
    const [counts, stockSummary, lowStockCount, recentMovs, categoryStats] = await Promise.all([
      db.execute("SELECT COUNT(*) as total_productos FROM productos WHERE activo = 1"),
      db.execute(`
        SELECT 
          COALESCE(SUM(stock_actual), 0) as stock_total_unidades,
          COALESCE(SUM(CASE WHEN stock_actual > 0 THEN valor_total_usd ELSE 0 END), 0) as valor_total_usd
        FROM vista_inventario_actual
      `),
      db.execute("SELECT COUNT(*) as alert_count FROM vista_inventario_actual WHERE estado_stock = 'SOLICITAR MATERIAL'"),
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
        LIMIT 10
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
      `)
    ]);

    res.json({
      totalProductos: counts.rows[0].total_productos,
      stockTotalUnidades: stockSummary.rows[0].stock_total_unidades,
      valorTotalUsd: stockSummary.rows[0].valor_total_usd,
      productosEnAlerta: lowStockCount.rows[0].alert_count,
      recientes: recentMovs.rows,
      topCategorias: categoryStats.rows
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
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
          END), 0), 2) AS stock_actual,
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
          END), 0) * p.costo_referencial_usd, 2) AS valor_total_usd,
          CASE 
            WHEN COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
              WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
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
      sql += ` AND (p.codigo LIKE ? OR p.descripcion LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`);
    }

    if (categoria && categoria !== 'TODAS') {
      sql += ` AND categoria = ?`;
      args.push(categoria);
    }

    if (almacen && almacen !== 'TODOS') {
      sql += ` AND almacen = ?`;
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

    const result = await db.execute({ sql, args });
    res.json(result.rows);
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
      '2026-08': 'Agosto 2026'
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
      '2026-08': '2026-08-31'
    };

    let runningStock = 0;
    const monthlyReport = rawMovs.rows.map(row => {
      const saldoInicialPeriodo = runningStock;
      const entradas = (row.inicial_unidades || 0) + (row.compras_unidades || 0);
      const salidas = (row.ventas_unidades || 0);
      runningStock = saldoInicialPeriodo + entradas - salidas;

      return {
        periodo: row.periodo,
        nombre: periodNames[row.periodo] || row.periodo,
        fechaCorte: periodDates[row.periodo] || `${row.periodo}-28`,
        saldoInicial: Math.round(saldoInicialPeriodo * 10) / 10,
        entradasInicial: row.inicial_unidades || 0,
        compras: row.compras_unidades || 0,
        comprasUsd: Math.round((row.compras_usd || 0) * 100) / 100,
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
    const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email } = req.body;
    if (!rif || !razon_social) {
      return res.status(400).json({ error: 'RIF y Razón Social son obligatorios' });
    }
    const cleanRif = String(rif).trim().toUpperCase();
    const cleanRazon = String(razon_social).trim();
    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    const retencionNum = Number(porcentaje_retencion) || 75.0;

    const result = await db.execute({
      sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt, retencionNum, telefono || null, email || null]
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
    const { rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion, telefono, email } = req.body;
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
                email = ?
            WHERE id = ?`,
      args: [cleanRif, cleanRazon, cleanTipo, aplicaInvInt, retencionNum, telefono || null, email || null, id]
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

// 6. Record New Inbound / Outbound Movement (Atomic Transaction)
app.post('/api/movimientos', async (req, res) => {
  try {
    const { tipo, fecha, numero_documento, proveedor_id, observaciones, items } = req.body;

    if (!tipo || !['ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    }

    if (!fecha) {
      return res.status(400).json({ error: 'La fecha es obligatoria' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos un producto en el movimiento' });
    }

    // Verify stock availability for SALIDA_VENTA
    if (tipo === 'SALIDA_VENTA') {
      for (const item of items) {
        const stockRes = await db.execute({
          sql: "SELECT stock_actual, descripcion, codigo FROM vista_inventario_actual WHERE producto_id = ?",
          args: [item.producto_id]
        });
        if (stockRes.rows.length > 0) {
          const currentStock = stockRes.rows[0].stock_actual;
          if (currentStock < item.cantidad) {
            return res.status(400).json({
              error: `Stock insuficiente para ${stockRes.rows[0].codigo} (${stockRes.rows[0].descripcion}). Disponible: ${currentStock}, Solicitado: ${item.cantidad}`
            });
          }
        }
      }
    }

    // Build batch statements for atomic commit
    const statements = [
      {
        sql: `INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones) VALUES (?, ?, ?, ?, ?)`,
        args: [
          tipo, 
          fecha, 
          numero_documento || (tipo === 'ENTRADA_COMPRA' ? 'COMPRA-S/N' : 'VENTA-S/N'), 
          proveedor_id ? parseInt(proveedor_id, 10) : null, 
          observaciones || ''
        ]
      }
    ];

    // Execute header first to get ID
    const headerResult = await db.execute(statements[0]);
    const movimientoId = Number(headerResult.lastInsertRowid);

    // Now insert detail items
    const detailStatements = items.map(it => ({
      sql: `INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd) VALUES (?, ?, ?, ?)`,
      args: [
        movimientoId, 
        parseInt(it.producto_id, 10), 
        parseFloat(it.cantidad), 
        parseFloat(it.costo_unitario_usd || 0)
      ]
    }));

    await db.batch(detailStatements);

    res.json({
      success: true,
      message: `${tipo === 'ENTRADA_COMPRA' ? 'Entrada (Compra)' : 'Salida (Venta)'} registrada con éxito`,
      movimientoId,
      itemsCount: items.length
    });
  } catch (error) {
    console.error('Error creating movement:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Movements History
app.get('/api/movimientos', async (req, res) => {
  try {
    const { tipo, desde, hasta, q, limit = 100 } = req.query;
    let sql = `
      SELECT 
        m.id, m.tipo, m.fecha, m.numero_documento, m.observaciones,
        COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as proveedor_nombre,
        COALESCE(pr.rif, '-') as proveedor_rif,
        COUNT(md.id) as total_items,
        COALESCE(SUM(md.cantidad), 0) as total_unidades,
        COALESCE(SUM(md.cantidad * md.costo_unitario_usd), 0) as total_usd
      FROM movimientos m
      LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
      LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
      WHERE 1=1
    `;
    const args = [];

    if (tipo && tipo !== 'TODOS') {
      sql += ` AND m.tipo = ?`;
      args.push(tipo);
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
      sql += ` AND (m.numero_documento LIKE ? OR pr.razon_social LIKE ? OR m.observaciones LIKE ?)`;
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ` GROUP BY m.id ORDER BY m.fecha DESC, m.id DESC LIMIT ?`;
    args.push(parseInt(limit, 10));

    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Individual Movement Details
app.get('/api/movimientos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [header, details] = await Promise.all([
      db.execute({
        sql: `
          SELECT m.*, COALESCE(pr.razon_social, 'N/A') as proveedor_nombre, COALESCE(pr.rif, 'N/A') as proveedor_rif 
          FROM movimientos m 
          LEFT JOIN proveedores pr ON m.proveedor_id = pr.id 
          WHERE m.id = ?
        `,
        args: [id]
      }),
      db.execute({
        sql: `
          SELECT md.*, p.codigo, p.descripcion, p.unidad_medida, (md.cantidad * md.costo_unitario_usd) as subtotal_usd 
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

    res.json({
      header: header.rows[0],
      items: details.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Kardex by Product
app.get('/api/kardex/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const prodRes = await db.execute({
      sql: `SELECT * FROM vista_inventario_actual WHERE UPPER(codigo) = UPPER(?)`,
      args: [codigo]
    });

    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const prod = prodRes.rows[0];

    const movsRes = await db.execute({
      sql: `
        SELECT 
          m.id as movimiento_id,
          m.fecha,
          m.tipo,
          m.numero_documento,
          COALESCE(pr.razon_social, 'CLIENTE / GENERAL') as tercero,
          md.costo_unitario_usd,
          CASE WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad ELSE 0 END as entrada,
          CASE WHEN m.tipo = 'SALIDA_VENTA' THEN md.cantidad ELSE 0 END as salida
        FROM movimiento_detalles md
        JOIN movimientos m ON md.movimiento_id = m.id
        LEFT JOIN proveedores pr ON m.proveedor_id = pr.id
        WHERE md.producto_id = ?
        ORDER BY m.fecha ASC, m.id ASC
      `,
      args: [prod.producto_id]
    });

    // Compute running balance
    let balance = 0;
    const history = movsRes.rows.map(row => {
      balance += (row.entrada - row.salida);
      return {
        ...row,
        saldo: Math.round(balance * 100) / 100
      };
    });

    res.json({
      producto: prod,
      historial: history
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Export Inventory to Excel (Supports Live or Historical Cutoff)
app.get('/api/export/excel', async (req, res) => {
  try {
    const { fecha_corte } = req.query;
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
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
          END), 0), 2) as "INVENTARIO AL CORTE",
          p.costo_referencial_usd as "COSTO PROM ($)",
          ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
          END), 0) * p.costo_referencial_usd, 2) as "VALOR TOTAL ($)",
          CASE 
            WHEN COALESCE(SUM(CASE 
              WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
              WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
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
      args.push(fecha_corte);
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
          costo_referencial_usd as "COSTO PROM ($)",
          valor_total_usd as "VALOR TOTAL ($)",
          estado_stock as "ESTADO"
        FROM vista_inventario_actual
        ORDER BY codigo ASC
      `;
    }

    const result = await db.execute({ sql, args });

    const sheetName = fecha_corte ? `CORTE_${fecha_corte}` : 'INVENTARIO AL DÍA';
    const ws = XLSX.utils.json_to_sheet(result.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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

// 10.1 Libro de Compras con Filtros y Clasificación
app.get('/api/fiscal/libro-compras', async (req, res) => {
  try {
    const { periodo, tipo_servicio, estatus, aplica_inventario } = req.query;
    let sql = `
      SELECT 
        lc.id,
        lc.periodo,
        lc.fecha,
        lc.nro_operacion,
        lc.rif,
        lc.razon_social,
        lc.nro_factura,
        lc.nro_control,
        lc.base_imponible_bs,
        lc.iva_bs,
        lc.total_bs,
        lc.iva_retenido_bs,
        lc.tipo_servicio,
        lc.aplica_inventario,
        lc.estatus_conciliacion,
        lc.movimiento_id,
        lc.observaciones_cruce,
        p.razon_social as proveedor_registrado_nombre
      FROM libro_compras lc
      LEFT JOIN proveedores p ON lc.proveedor_id = p.id
      WHERE 1=1
    `;
    const args = [];

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

// 10.2 Libro de Ventas Fiscal (Impresora ZOA0000176)
app.get('/api/fiscal/libro-ventas', async (req, res) => {
  try {
    const { periodo } = req.query;
    let sql = `SELECT * FROM libro_ventas WHERE 1=1`;
    const args = [];
    if (periodo && periodo !== 'TODOS') {
      sql += ` AND periodo = ?`;
      args.push(periodo);
    }
    sql += ` ORDER BY periodo ASC, fecha ASC`;
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

// 10.6 Registrar Nueva Factura en Libro de Compras (En vez del XLS)
app.post('/api/fiscal/libro-compras', async (req, res) => {
  try {
    const {
      periodo, fecha, rif, razon_social, nro_factura, nro_control,
      tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs,
      iva_retenido_bs, tipo_servicio, aplica_inventario, observaciones_cruce
    } = req.body;

    if (!periodo || !fecha || !rif || !razon_social || !nro_factura) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (Período, Fecha, RIF, Proveedor, Nro Factura)' });
    }

    const cleanRif = String(rif).trim().toUpperCase();
    const cleanRazon = String(razon_social).trim();
    const base = Number(base_imponible_bs) || 0.0;
    const ali = Number(alicuota) || 0.16;
    const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((base * ali).toFixed(2));
    const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((base + ivaCalc).toFixed(2));
    const ret = Number(iva_retenido_bs) || 0.0;

    const cleanTipo = tipo_servicio || 'MERCANCIA_REPUESTOS';
    const aplicaInvInt = (aplica_inventario === 1 || aplica_inventario === true || aplica_inventario === '1') ? 1 : 0;
    const estatus = aplicaInvInt === 0 ? 'NO_APLICA_GASTO' : 'NO_CONCILIADO';
    const obs = observaciones_cruce || (aplicaInvInt === 0 ? `Gasto / Servicio (${cleanTipo})` : 'Factura cargada desde el sistema web');

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
            (periodo, archivo_origen, nro_operacion, fecha, rif, razon_social, nro_factura, nro_control,
             tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs, iva_retenido_bs,
             proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, observaciones_cruce)
            VALUES (?, 'SISTEMA_WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id`,
      args: [
        periodo, nextOp, fecha, cleanRif, cleanRazon, nro_factura, nro_control || null,
        tipo_transaccion || '01-reg', base, ali, ivaCalc, totalCalc, ret,
        provId, cleanTipo, aplicaInvInt, estatus, obs
      ]
    });

    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: insertResult.rows?.[0]?.id,
      message: 'Factura registrada con éxito en el Libro de Compras'
    });
  } catch (error) {
    console.error('Error registrando factura en libro compras:', error);
    res.status(500).json({ error: error.message });
  }
});

// 10.7 Eliminar Factura de Compra
app.delete('/api/fiscal/libro-compras/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const rowRes = await db.execute({ sql: "SELECT periodo FROM libro_compras WHERE id = ?", args: [id] });
    if (rowRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    const periodo = rowRes.rows[0].periodo;

    await db.execute({ sql: "DELETE FROM libro_compras WHERE id = ?", args: [id] });
    await recalculateDeclaracionIva(periodo);

    res.json({ success: true, message: 'Factura eliminada del Libro de Compras' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10.8 Registrar Venta Diaria / Reporte Z en Libro de Ventas
app.post('/api/fiscal/libro-ventas', async (req, res) => {
  try {
    const {
      periodo, fecha, factura_desde, factura_hasta, total_bs,
      exento_bs, base_imponible_bs, alicuota, iva_bs, cantidad_comprobantes
    } = req.body;

    if (!periodo || !fecha || base_imponible_bs === undefined) {
      return res.status(400).json({ error: 'Faltan campos requeridos (Período, Fecha, Base Imponible)' });
    }

    const base = Number(base_imponible_bs) || 0.0;
    const ali = Number(alicuota) || 0.16;
    const ex = Number(exento_bs) || 0.0;
    const ivaCalc = (iva_bs !== undefined && iva_bs !== null && iva_bs !== '') ? Number(iva_bs) : Number((base * ali).toFixed(2));
    const totalCalc = (total_bs !== undefined && total_bs !== null && total_bs !== '') ? Number(total_bs) : Number((base + ivaCalc + ex).toFixed(2));
    const cant = Number(cantidad_comprobantes) || 1;

    const insertResult = await db.execute({
      sql: `INSERT INTO libro_ventas 
            (periodo, archivo_origen, fecha, factura_desde, factura_hasta, total_bs, exento_bs,
             base_imponible_bs, alicuota, iva_bs, cantidad_comprobantes, estatus_conciliacion)
            VALUES (?, 'SISTEMA_WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REGISTRADO_FISCAL')
            RETURNING id`,
      args: [
        periodo, fecha, factura_desde || null, factura_hasta || null, totalCalc, ex,
        base, ali, ivaCalc, cant
      ]
    });

    await recalculateDeclaracionIva(periodo);

    res.json({
      success: true,
      id: insertResult.rows?.[0]?.id,
      message: 'Venta registrada con éxito en el Libro de Ventas'
    });
  } catch (error) {
    console.error('Error registrando venta en libro ventas:', error);
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

    await db.execute({ sql: "DELETE FROM libro_ventas WHERE id = ?", args: [id] });
    await recalculateDeclaracionIva(periodo);

    res.json({ success: true, message: 'Registro eliminado del Libro de Ventas' });
  } catch (error) {
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

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
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

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `LIBRO_VENTAS_DG67_${periodo || 'HISTORICO'}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
