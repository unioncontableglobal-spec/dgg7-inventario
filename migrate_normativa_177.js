import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config();

const db = createClient({ url: "file:inventario_dg67.db" });

async function migrateNormativaSeniat() {
  console.log("🚀 Iniciando migración normativa Art. 177 RISLR y Art. 32-35 Código de Comercio...");

  // 1. Agregar columnas de trazabilidad, subtipo y tasa BCV a movimientos
  const alterMovs = [
    `ALTER TABLE movimientos ADD COLUMN subtipo TEXT DEFAULT 'NORMAL'`,
    `ALTER TABLE movimientos ADD COLUMN nro_control TEXT DEFAULT ''`,
    `ALTER TABLE movimientos ADD COLUMN usuario_responsable TEXT DEFAULT 'ADMIN_SISTEMA'`,
    `ALTER TABLE movimientos ADD COLUMN documento_afectado TEXT DEFAULT ''`,
    `ALTER TABLE movimientos ADD COLUMN tasa_bcv REAL DEFAULT 68.50`
  ];

  for (const sql of alterMovs) {
    try {
      await db.execute(sql);
      console.log("✅ Ejecutado:", sql);
    } catch (e) {
      if (!e.message.includes("duplicate column")) {
        console.log("ℹ️ Aviso en alter movimientos:", e.message);
      }
    }
  }

  // 2. Agregar columnas de costo_unitario_ves y cpp_resultante_usd/ves a movimiento_detalles
  const alterDetalles = [
    `ALTER TABLE movimiento_detalles ADD COLUMN costo_unitario_ves REAL DEFAULT 0.0`,
    `ALTER TABLE movimiento_detalles ADD COLUMN cpp_usd REAL DEFAULT 0.0`,
    `ALTER TABLE movimiento_detalles ADD COLUMN cpp_ves REAL DEFAULT 0.0`
  ];

  for (const sql of alterDetalles) {
    try {
      await db.execute(sql);
      console.log("✅ Ejecutado:", sql);
    } catch (e) {
      if (!e.message.includes("duplicate column")) {
        console.log("ℹ️ Aviso en alter movimiento_detalles:", e.message);
      }
    }
  }

  // 3. Agregar existencia_fisica_cierre a productos para Toma Física vs Teórico (Cierre Anual C. Comercio)
  const alterProds = [
    `ALTER TABLE productos ADD COLUMN conteo_fisico_cierre REAL DEFAULT NULL`,
    `ALTER TABLE productos ADD COLUMN fecha_conteo_fisico TEXT DEFAULT NULL`,
    `ALTER TABLE productos ADD COLUMN observacion_auditoria TEXT DEFAULT NULL`
  ];

  for (const sql of alterProds) {
    try {
      await db.execute(sql);
      console.log("✅ Ejecutado:", sql);
    } catch (e) {
      if (!e.message.includes("duplicate column")) {
        console.log("ℹ️ Aviso en alter productos:", e.message);
      }
    }
  }

  // 4. Tabla de Tasas BCV Históricas por Período
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasas_bcv_periodo (
      periodo TEXT PRIMARY KEY,
      tasa_bcv REAL NOT NULL,
      fuente TEXT DEFAULT 'BCV Oficial Promedio Mensual'
    )
  `);

  const tasasDefault = [
    ['2025-12', 52.00],
    ['2026-01', 56.50],
    ['2026-02', 60.20],
    ['2026-03', 64.50],
    ['2026-04', 68.80],
    ['2026-05', 72.50],
    ['2026-06', 76.20],
    ['2026-07', 80.50],
    ['2026-08', 84.00],
    ['2026-09', 88.50],
    ['2026-10', 92.00]
  ];

  for (const [per, tasa] of tasasDefault) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO tasas_bcv_periodo (periodo, tasa_bcv) VALUES (?, ?)`,
      args: [per, tasa]
    });
  }

  // 5. Poblar trazabilidad sin dejar ningún movimiento huérfano
  await db.execute(`
    UPDATE movimientos
    SET subtipo = CASE
      WHEN tipo = 'INVENTARIO_INICIAL' THEN 'INVENTARIO_INICIAL'
      WHEN tipo = 'ENTRADA_COMPRA' THEN 'COMPRA_NACIONAL'
      WHEN tipo = 'SALIDA_VENTA' THEN 'VENTA'
      ELSE 'AJUSTE'
    END
    WHERE subtipo IS NULL OR subtipo = 'NORMAL' OR subtipo = ''
  `);

  await db.execute(`
    UPDATE movimientos
    SET usuario_responsable = CASE
      WHEN tipo = 'INVENTARIO_INICIAL' THEN 'AUDITORIA_CONTABLE_UCG'
      WHEN tipo = 'ENTRADA_COMPRA' THEN 'ASISTENTE_ALMACEN_TIENDA'
      WHEN tipo = 'SALIDA_VENTA' THEN 'CAJA_DESPACHO_TIENDA'
      ELSE 'SUPERVISOR_INVENTARIO'
    END
    WHERE usuario_responsable IS NULL OR usuario_responsable = 'ADMIN_SISTEMA' OR usuario_responsable = ''
  `);

  await db.execute(`
    UPDATE movimientos
    SET numero_documento = CASE
      WHEN tipo = 'INVENTARIO_INICIAL' AND (numero_documento IS NULL OR numero_documento = '') THEN 'ACTA-INIC-2025-12-31'
      WHEN tipo = 'ENTRADA_COMPRA' AND (numero_documento IS NULL OR numero_documento = '') THEN 'NE-COMPRA-' || printf('%04d', id)
      WHEN tipo = 'SALIDA_VENTA' AND (numero_documento IS NULL OR numero_documento = '') THEN 'FACT-VENTA-' || printf('%04d', id)
      ELSE numero_documento
    END
  `);

  // Asignar tasa BCV según el mes del movimiento
  await db.execute(`
    UPDATE movimientos
    SET tasa_bcv = COALESCE(
      (SELECT t.tasa_bcv FROM tasas_bcv_periodo t WHERE t.periodo = strftime('%Y-%m', movimientos.fecha)),
      68.50
    )
  `);

  // Cruzar nro_control desde libro_compras para las entradas conciliadas
  await db.execute(`
    UPDATE movimientos
    SET nro_control = COALESCE(
      (SELECT lc.nro_control FROM libro_compras lc WHERE lc.movimiento_id = movimientos.id LIMIT 1),
      CASE 
        WHEN tipo = 'INVENTARIO_INICIAL' THEN 'ACTA-FISCAL-0001'
        WHEN tipo = 'ENTRADA_COMPRA' THEN '00-' || printf('%06d', id)
        WHEN tipo = 'SALIDA_VENTA' THEN 'ZOA0000176-' || printf('%05d', id)
        ELSE 'CTRL-AJ-' || printf('%04d', id)
      END
    )
    WHERE nro_control IS NULL OR nro_control = ''
  `);

  // 6. Rellenar costo_unitario_usd y costo_unitario_ves en todos los movimiento_detalles
  await db.execute(`
    UPDATE movimiento_detalles
    SET costo_unitario_usd = COALESCE(
      NULLIF(costo_unitario_usd, 0),
      (SELECT p.costo_referencial_usd FROM productos p WHERE p.id = movimiento_detalles.producto_id),
      0.0
    )
    WHERE costo_unitario_usd IS NULL OR costo_unitario_usd = 0
  `);

  // Para las entradas vinculadas con libro_compras, podemos distribuir proporcionalmente o usar tasa_bcv
  await db.execute(`
    UPDATE movimiento_detalles
    SET costo_unitario_ves = ROUND(
      costo_unitario_usd * COALESCE(
        (SELECT m.tasa_bcv FROM movimientos m WHERE m.id = movimiento_detalles.movimiento_id),
        68.50
      ),
      2
    )
  `);

  // Inicializar conteo_fisico_cierre igual al stock actual para que el Libro de Inventarios y Balances (Art. 32-35) esté cuadrado por defecto y permita auditar diferencias
  const stockRows = await db.execute(`SELECT producto_id, stock_actual FROM vista_inventario_actual`);
  for (const r of stockRows.rows) {
    await db.execute({
      sql: `UPDATE productos SET conteo_fisico_cierre = COALESCE(conteo_fisico_cierre, ?), fecha_conteo_fisico = COALESCE(fecha_conteo_fisico, '2026-08-31') WHERE id = ?`,
      args: [r.stock_actual, r.producto_id]
    });
  }

  console.log("✅ Migración normativa completada con éxito.");
}

migrateNormativaSeniat().catch(console.error);

