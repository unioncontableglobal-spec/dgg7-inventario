/**
 * MIGRACIÓN Y REVALORIZACIÓN HISTÓRICA BCV:
 * MÓDULO DE VALORACIÓN DE INVENTARIO (KARDEX) Y DOBLE EXPRESIÓN MONETARIA (SENIAT PA SNAT/2026/00093)
 *
 * 1. Tasas Oficiales de Cierre de Mes BCV (2025-12 a 2026-10) configurables.
 * 2. Columnas requeridas en movimiento_detalles:
 *    - costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs
 *    - precio_unitario_bs, precio_unitario_divisa, base_imponible_bs, base_imponible_divisa,
 *      monto_iva_bs, monto_iva_divisa, total_linea_bs, total_linea_divisa
 * 3. Columnas de Doble Expresión Monetaria en libro_compras, libro_ventas y retenciones_islr_detalles.
 * 4. Revalorización automática de meses declarados (que tenían montos solo en USD en Kardex o solo en Bs en Libros)
 *    usando la Tasa Oficial BCV de Cierre de Mes.
 */
import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:inventario_dg67.db' });

async function safeAlter(sql) {
  try {
    await db.execute(sql);
    console.log('OK:', sql);
  } catch (e) {
    if (!e.message.includes('duplicate column')) {
      console.warn('Warn:', e.message);
    }
  }
}

async function run() {
  console.log('Iniciando migración de Valoración Kardex y Doble Expresión Monetaria (PA SNAT/2026/00093)...');

  // 1. Extender tabla tasas_bcv_periodo con fecha_cierre, tasa_promedio y metodo_valoracion
  await safeAlter("ALTER TABLE tasas_bcv_periodo ADD COLUMN fecha_cierre TEXT DEFAULT ''");
  await safeAlter("ALTER TABLE tasas_bcv_periodo ADD COLUMN moneda TEXT DEFAULT 'USD'");

  const cierresBcv = [
    ['2025-12', 52.02, '31/12/2025', 'USD', 'Tasa Oficial BCV al Cierre de Diciembre 2025 (Inventario Inicial)'],
    ['2026-01', 56.50, '31/01/2026', 'USD', 'Tasa Oficial BCV al Cierre de Enero 2026'],
    ['2026-02', 60.20, '28/02/2026', 'USD', 'Tasa Oficial BCV al Cierre de Febrero 2026'],
    ['2026-03', 64.50, '31/03/2026', 'USD', 'Tasa Oficial BCV al Cierre de Marzo 2026'],
    ['2026-04', 68.80, '30/04/2026', 'USD', 'Tasa Oficial BCV al Cierre de Abril 2026'],
    ['2026-05', 72.50, '31/05/2026', 'USD', 'Tasa Oficial BCV al Cierre de Mayo 2026'],
    ['2026-06', 76.20, '30/06/2026', 'USD', 'Tasa Oficial BCV al Cierre de Junio 2026'],
    ['2026-07', 80.50, '31/07/2026', 'USD', 'Tasa Oficial BCV al Cierre de Julio 2026'],
    ['2026-08', 84.00, '31/08/2026', 'USD', 'Tasa Oficial BCV al Cierre de Agosto 2026'],
    ['2026-09', 88.50, '30/09/2026', 'USD', 'Tasa Oficial BCV al Cierre de Septiembre 2026'],
    ['2026-10', 92.00, '31/10/2026', 'USD', 'Tasa Oficial BCV Octubre 2026 (En Curso)']
  ];

  for (const [per, tasa, fCierre, mon, fuente] of cierresBcv) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO tasas_bcv_periodo (periodo, tasa_bcv, fecha_cierre, moneda, fuente) VALUES (?, ?, ?, ?, ?)`,
      args: [per, tasa, fCierre, mon, fuente]
    });
  }

  // 2. Añadir método de valoración configurado (CPP o PEPS/FIFO) en config_fiscal_islr
  await safeAlter("ALTER TABLE config_fiscal_islr ADD COLUMN metodo_valoracion_kardex TEXT DEFAULT 'CPP'");

  // 3. Añadir campos obligatorios en movimiento_detalles (Kardex y Doble Expresión por línea)
  const alterMovDetalles = [
    "ALTER TABLE movimiento_detalles ADD COLUMN costo_unitario_divisa REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN tasa_bcv_operacion REAL DEFAULT 68.50",
    "ALTER TABLE movimiento_detalles ADD COLUMN costo_unitario_bs REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN precio_unitario_bs REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN precio_unitario_divisa REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN base_imponible_bs REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN base_imponible_divisa REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN monto_iva_bs REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN monto_iva_divisa REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN total_linea_bs REAL DEFAULT 0.0",
    "ALTER TABLE movimiento_detalles ADD COLUMN total_linea_divisa REAL DEFAULT 0.0"
  ];
  for (const sql of alterMovDetalles) await safeAlter(sql);

  await safeAlter("ALTER TABLE movimientos ADD COLUMN fecha_tasa_bcv TEXT DEFAULT ''");
  await safeAlter("ALTER TABLE movimientos ADD COLUMN moneda_operacion TEXT DEFAULT 'USD'");
  await safeAlter("ALTER TABLE movimientos ADD COLUMN metodo_valoracion TEXT DEFAULT 'CPP'");

  // 4. Añadir campos de Doble Expresión Monetaria en libro_compras, libro_ventas y retenciones_islr_detalles
  const alterLibroCompras = [
    "ALTER TABLE libro_compras ADD COLUMN tasa_bcv REAL DEFAULT 68.50",
    "ALTER TABLE libro_compras ADD COLUMN fecha_tasa_bcv TEXT DEFAULT ''",
    "ALTER TABLE libro_compras ADD COLUMN moneda_divisa TEXT DEFAULT 'USD'",
    "ALTER TABLE libro_compras ADD COLUMN base_imponible_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_compras ADD COLUMN monto_iva_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_compras ADD COLUMN total_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_compras ADD COLUMN iva_retenido_divisa REAL DEFAULT 0.0"
  ];
  for (const sql of alterLibroCompras) await safeAlter(sql);

  const alterLibroVentas = [
    "ALTER TABLE libro_ventas ADD COLUMN tasa_bcv REAL DEFAULT 68.50",
    "ALTER TABLE libro_ventas ADD COLUMN fecha_tasa_bcv TEXT DEFAULT ''",
    "ALTER TABLE libro_ventas ADD COLUMN moneda_divisa TEXT DEFAULT 'USD'",
    "ALTER TABLE libro_ventas ADD COLUMN exento_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_ventas ADD COLUMN base_imponible_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_ventas ADD COLUMN monto_iva_divisa REAL DEFAULT 0.0",
    "ALTER TABLE libro_ventas ADD COLUMN total_divisa REAL DEFAULT 0.0"
  ];
  for (const sql of alterLibroVentas) await safeAlter(sql);

  const alterRetDetalles = [
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN tasa_bcv_linea REAL DEFAULT 68.50",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN precio_unitario_bs REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN precio_unitario_divisa REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN base_imponible_divisa REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN monto_iva_bs REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN monto_iva_divisa REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN total_linea_bs REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN total_linea_divisa REAL DEFAULT 0.0",
    "ALTER TABLE retenciones_islr_detalles ADD COLUMN impuesto_retenido_divisa REAL DEFAULT 0.0"
  ];
  for (const sql of alterRetDetalles) await safeAlter(sql);

  // 5. APLICAR REVALORIZACIÓN AUTOMÁTICA POR TASA BCV DE CIERRE DE MES EN MESES DECLARADOS
  console.log('Sincronizando tasas BCV de cierre de mes en Movimientos (Kardex), Libro de Compras, Libro de Ventas y Retenciones...');

  // 5.1 Actualizar movimientos con la tasa_bcv y fecha_tasa_bcv de su período
  await db.execute(`
    UPDATE movimientos
    SET tasa_bcv = COALESCE(
          (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
          68.50
        ),
        fecha_tasa_bcv = COALESCE(
          (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = substr(movimientos.fecha, 1, 7)),
          movimientos.fecha
        ),
        moneda_operacion = 'USD',
        metodo_valoracion = 'CPP'
  `);

  // 5.2 Actualizar movimiento_detalles con costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs y campos de doble expresión
  await db.execute(`
    UPDATE movimiento_detalles
    SET costo_unitario_divisa = ROUND(COALESCE(
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

  // 5.3 Actualizar libro_compras con la tasa BCV de cierre de mes y su expresión en divisas
  await db.execute(`
    UPDATE libro_compras
    SET tasa_bcv = COALESCE(
          (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
          68.50
        ),
        fecha_tasa_bcv = COALESCE(
          (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = libro_compras.periodo),
          libro_compras.fecha
        ),
        moneda_divisa = 'USD'
  `);

  await db.execute(`
    UPDATE libro_compras
    SET base_imponible_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        monto_iva_divisa = ROUND(iva_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        total_divisa = ROUND(total_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        iva_retenido_divisa = ROUND(COALESCE(iva_retenido_bs, 0) / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2)
  `);

  // 5.4 Actualizar libro_ventas con la tasa BCV de cierre de mes y su expresión en divisas
  await db.execute(`
    UPDATE libro_ventas
    SET tasa_bcv = COALESCE(
          (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
          68.50
        ),
        fecha_tasa_bcv = COALESCE(
          (SELECT t.fecha_cierre FROM tasas_bcv_periodo t WHERE t.periodo = libro_ventas.periodo),
          libro_ventas.fecha
        ),
        moneda_divisa = 'USD'
  `);

  await db.execute(`
    UPDATE libro_ventas
    SET exento_divisa = ROUND(COALESCE(exento_bs, 0) / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        base_imponible_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        monto_iva_divisa = ROUND(iva_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2),
        total_divisa = ROUND(total_bs / CASE WHEN tasa_bcv > 0 THEN tasa_bcv ELSE 68.50 END, 2)
  `);

  // 5.5 Actualizar retenciones_islr y retenciones_islr_detalles con la tasa BCV de su período y doble expresión
  await db.execute(`
    UPDATE retenciones_islr
    SET tasa_bcv = COALESCE(
          (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = retenciones_islr.periodo),
          tasa_bcv,
          68.50
        ),
        es_multimoneda = 1
  `);

  await db.execute(`
    UPDATE retenciones_islr_detalles
    SET tasa_bcv_linea = COALESCE(
          (SELECT r.tasa_bcv FROM retenciones_islr r WHERE r.id = retenciones_islr_detalles.retencion_id),
          68.50
        )
  `);

  await db.execute(`
    UPDATE retenciones_islr_detalles
    SET precio_unitario_bs = base_imponible_bs,
        precio_unitario_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv_linea > 0 THEN tasa_bcv_linea ELSE 68.50 END, 2),
        base_imponible_divisa = ROUND(base_imponible_bs / CASE WHEN tasa_bcv_linea > 0 THEN tasa_bcv_linea ELSE 68.50 END, 2),
        monto_iva_bs = ROUND(monto_total_bs - base_imponible_bs, 2),
        monto_iva_divisa = ROUND((monto_total_bs - base_imponible_bs) / CASE WHEN tasa_bcv_linea > 0 THEN tasa_bcv_linea ELSE 68.50 END, 2),
        total_linea_bs = monto_total_bs,
        total_linea_divisa = ROUND(monto_total_bs / CASE WHEN tasa_bcv_linea > 0 THEN tasa_bcv_linea ELSE 68.50 END, 2),
        impuesto_retenido_divisa = ROUND(impuesto_retenido_bs / CASE WHEN tasa_bcv_linea > 0 THEN tasa_bcv_linea ELSE 68.50 END, 2)
  `);

  console.log('Migración y revalorización histórica completadas con éxito.');
}

run().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});

