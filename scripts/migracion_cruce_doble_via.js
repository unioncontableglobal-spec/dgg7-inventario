/**
 * scripts/migracion_cruce_doble_via.js
 * Migración para el esquema de Cruce de Información (Conciliación de Doble Vía DG67 ↔ UCG)
 * Utiliza @libsql/client para operar sobre inventario_dg67.db y Turso Cloud
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const isTurso = process.env.TARGET === 'turso';
const client = isTurso
  ? createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    })
  : createClient({ url: 'file:inventario_dg67.db' });

async function addColumnIfNotExists(table, columnDef, columnName) {
  const tableInfo = await client.execute(`PRAGMA table_info(${table})`);
  const exists = tableInfo.rows.some(col => String(col.name).toLowerCase() === columnName.toLowerCase());
  if (!exists) {
    console.log(`Agregando columna [${columnName}] a tabla [${table}]...`);
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    console.log(`Columna [${columnName}] agregada con éxito.`);
  } else {
    console.log(`Columna [${columnName}] ya existe en tabla [${table}].`);
  }
}

async function run() {
  console.log('=== Iniciando Migración: Esquema Cruce Doble Vía DG67 ↔ UCG ===');

  // 1. Columnas en libro_ventas
  await addColumnIfNotExists('libro_ventas', 'numero_reporte_z TEXT DEFAULT ""', 'numero_reporte_z');
  await addColumnIfNotExists('libro_ventas', 'serial_impresora TEXT DEFAULT "Z0A0000176"', 'serial_impresora');
  await addColumnIfNotExists('libro_ventas', 'cantidad_anuladas INTEGER DEFAULT 0', 'cantidad_anuladas');
  await addColumnIfNotExists('libro_ventas', 'total_anulaciones_bs REAL DEFAULT 0.0', 'total_anulaciones_bs');
  await addColumnIfNotExists('libro_ventas', 'facturas_faltantes TEXT DEFAULT ""', 'facturas_faltantes');
  await addColumnIfNotExists('libro_ventas', 'cantidad_facturas_cargadas INTEGER DEFAULT 0', 'cantidad_facturas_cargadas');
  await addColumnIfNotExists('libro_ventas', 'total_facturas_cargadas_bs REAL DEFAULT 0.0', 'total_facturas_cargadas_bs');
  await addColumnIfNotExists('libro_ventas', 'diferencia_bs REAL DEFAULT 0.0', 'diferencia_bs');
  await addColumnIfNotExists('libro_ventas', 'observaciones_cruce TEXT DEFAULT ""', 'observaciones_cruce');

  // 2. Columnas en movimientos
  await addColumnIfNotExists('movimientos', 'estatus_conciliacion TEXT DEFAULT "PENDIENTE_UCG"', 'estatus_conciliacion');
  await addColumnIfNotExists('movimientos', 'libro_ventas_id INTEGER DEFAULT NULL', 'libro_ventas_id');
  await addColumnIfNotExists('movimientos', 'libro_compras_id INTEGER DEFAULT NULL', 'libro_compras_id');
  await addColumnIfNotExists('movimientos', 'numero_factura_numerico INTEGER DEFAULT NULL', 'numero_factura_numerico');

  // 3. Normalizar numero_factura_numerico para los movimientos existentes
  console.log('Normalizando número de factura numérico en movimientos existentes...');
  const movs = await client.execute("SELECT id, numero_documento FROM movimientos WHERE numero_documento IS NOT NULL AND numero_factura_numerico IS NULL");
  let batch = [];
  let actualizados = 0;
  for (const row of movs.rows) {
    if (!row.numero_documento) continue;
    const match = String(row.numero_documento).match(/(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      batch.push({
        sql: "UPDATE movimientos SET numero_factura_numerico = ? WHERE id = ?",
        args: [num, row.id]
      });
      actualizados++;
      if (batch.length >= 100) {
        await client.batch(batch, 'write');
        batch = [];
      }
    }
  }
  if (batch.length > 0) {
    await client.batch(batch, 'write');
  }
  console.log(`Normalizados ${actualizados} movimientos con su número de documento numérico.`);

  // 4. Crear Índices de búsqueda rápida
  console.log('Creando índices para el motor de cruce...');
  await client.execute("CREATE INDEX IF NOT EXISTS idx_mov_num_fact ON movimientos(numero_factura_numerico)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_mov_fecha_tipo ON movimientos(fecha, tipo)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_mov_concil ON movimientos(estatus_conciliacion)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_lv_fecha ON libro_ventas(fecha)");
  await client.execute("CREATE INDEX IF NOT EXISTS idx_lv_concil ON libro_ventas(estatus_conciliacion)");

  // 5. Crear Vistas de Cruce en Base de Datos
  console.log('Creando Vistas SQL de Cruce...');

  await client.execute("DROP VIEW IF EXISTS vista_ventas_dg67_resumen");
  await client.execute(`
    CREATE VIEW vista_ventas_dg67_resumen AS
    SELECT 
        m.id AS movimiento_id,
        m.fecha,
        m.numero_documento,
        m.numero_factura_numerico,
        m.estatus_conciliacion,
        m.libro_ventas_id,
        m.tasa_bcv,
        COUNT(md.id) AS total_items,
        COALESCE(SUM(md.cantidad), 0) AS total_unidades,
        COALESCE(SUM(NULLIF(md.base_imponible_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS base_imponible_bs,
        COALESCE(SUM(NULLIF(md.monto_iva_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs * 0.16), 0) AS iva_bs,
        COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs * 1.16), 0) AS total_bs,
        COALESCE(SUM(NULLIF(md.total_linea_divisa, 0)), SUM(md.cantidad * md.precio_unitario_divisa), 0) AS total_divisa
    FROM movimientos m
    LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
    WHERE m.tipo = 'SALIDA_VENTA'
    GROUP BY m.id
  `);

  await client.execute("DROP VIEW IF EXISTS vista_cruce_ventas_reportes_z");
  await client.execute(`
    CREATE VIEW vista_cruce_ventas_reportes_z AS
    SELECT 
        lv.id AS reporte_z_id,
        lv.periodo,
        lv.fecha,
        lv.numero_reporte_z,
        lv.serial_impresora,
        lv.factura_desde,
        lv.factura_hasta,
        lv.cantidad_comprobantes AS facturas_esperadas,
        lv.cantidad_anuladas,
        lv.base_imponible_bs AS base_z_bs,
        lv.iva_bs AS iva_z_bs,
        lv.total_bs AS total_z_bs,
        lv.total_divisa AS total_z_usd,
        lv.tasa_bcv,
        lv.estatus_conciliacion,
        lv.facturas_faltantes,
        lv.cantidad_facturas_cargadas,
        lv.total_facturas_cargadas_bs,
        lv.diferencia_bs,
        lv.observaciones_cruce
    FROM libro_ventas lv
  `);

  await client.execute("DROP VIEW IF EXISTS vista_cruce_compras_almacen");
  await client.execute(`
    CREATE VIEW vista_cruce_compras_almacen AS
    SELECT 
        lc.id AS libro_compra_id,
        lc.periodo,
        lc.fecha AS fecha_fiscal,
        lc.rif,
        lc.razon_social,
        lc.nro_factura,
        lc.nro_control,
        lc.tipo_servicio,
        lc.aplica_inventario,
        lc.base_imponible_bs AS base_fiscal_bs,
        lc.iva_bs AS iva_fiscal_bs,
        lc.total_bs AS total_fiscal_bs,
        lc.total_divisa AS total_fiscal_usd,
        lc.tasa_bcv,
        lc.estatus_conciliacion,
        m.id AS movimiento_almacen_id,
        m.fecha AS fecha_recepcion_fisica,
        m.numero_documento AS doc_almacen,
        (SELECT COUNT(*) FROM movimiento_detalles md WHERE md.movimiento_id = m.id) AS items_almacen,
        (SELECT SUM(md.cantidad) FROM movimiento_detalles md WHERE md.movimiento_id = m.id) AS unidades_almacen,
        (SELECT SUM(md.cantidad * md.costo_unitario_ves) FROM movimiento_detalles md WHERE md.movimiento_id = m.id) AS costo_total_almacen_bs,
        (SELECT SUM(md.cantidad * md.costo_unitario_usd) FROM movimiento_detalles md WHERE md.movimiento_id = m.id) AS costo_total_almacen_usd
    FROM libro_compras lc
    LEFT JOIN movimientos m ON lc.movimiento_id = m.id
  `);

  console.log('✅ Migración completada con éxito.');
}

run().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});
