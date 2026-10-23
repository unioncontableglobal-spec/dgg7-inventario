const { createClient } = require('@libsql/client');
const path = require('path');
require('dotenv').config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const turso = createClient({ url, authToken });
const localDb = createClient({ url: 'file:' + path.join(__dirname, 'inventario_dg67.db') });

async function syncToTurso() {
  console.log('--- SINCRONIZANDO TABLAS FISCALES A TURSO CLOUD ---');
  
  // 1. Alter proveedores in Turso
  try {
    await turso.execute("ALTER TABLE proveedores ADD COLUMN tipo_servicio TEXT DEFAULT 'MERCANCIA_REPUESTOS'");
    console.log('Columna tipo_servicio agregada a proveedores');
  } catch (e) {
    console.log('Columna tipo_servicio ya existía o ignorada');
  }

  try {
    await turso.execute("ALTER TABLE proveedores ADD COLUMN aplica_inventario INTEGER DEFAULT 1");
    console.log('Columna aplica_inventario agregada a proveedores');
  } catch (e) {
    console.log('Columna aplica_inventario ya existía o ignorada');
  }

  // 2. Create tables in Turso
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS libro_compras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo TEXT NOT NULL,
      archivo_origen TEXT,
      nro_operacion INTEGER,
      fecha DATE,
      rif TEXT,
      razon_social TEXT,
      nro_factura TEXT,
      nro_control TEXT,
      tipo_transaccion TEXT DEFAULT '01-reg',
      base_imponible_bs REAL DEFAULT 0.0,
      alicuota REAL DEFAULT 0.16,
      iva_bs REAL DEFAULT 0.0,
      total_bs REAL DEFAULT 0.0,
      iva_retenido_bs REAL DEFAULT 0.0,
      proveedor_id INTEGER REFERENCES proveedores(id),
      tipo_servicio TEXT DEFAULT 'MERCANCIA_REPUESTOS',
      aplica_inventario INTEGER DEFAULT 1,
      estatus_conciliacion TEXT DEFAULT 'PENDIENTE',
      movimiento_id INTEGER REFERENCES movimientos(id),
      observaciones_cruce TEXT
    );
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS libro_ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo TEXT NOT NULL,
      archivo_origen TEXT,
      fecha DATE,
      factura_desde TEXT,
      factura_hasta TEXT,
      total_bs REAL DEFAULT 0.0,
      exento_bs REAL DEFAULT 0.0,
      base_imponible_bs REAL DEFAULT 0.0,
      alicuota REAL DEFAULT 0.16,
      iva_bs REAL DEFAULT 0.0,
      cantidad_comprobantes INTEGER DEFAULT 0,
      estatus_conciliacion TEXT DEFAULT 'REGISTRADO_FISCAL'
    );
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS declaraciones_iva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      periodo TEXT UNIQUE NOT NULL,
      archivo_origen TEXT,
      ventas_base_bs REAL DEFAULT 0.0,
      debito_fiscal_bs REAL DEFAULT 0.0,
      compras_base_bs REAL DEFAULT 0.0,
      credito_fiscal_bs REAL DEFAULT 0.0,
      iva_retenido_bs REAL DEFAULT 0.0,
      total_compras_facturas INTEGER DEFAULT 0,
      total_ventas_dias INTEGER DEFAULT 0,
      estatus TEXT DEFAULT 'DECLARADO'
    );
  `);

  console.log('Tablas fiscales creadas en Turso Cloud.');

  // Clean target tables in Turso
  await turso.execute("DELETE FROM libro_compras;");
  await turso.execute("DELETE FROM libro_ventas;");
  await turso.execute("DELETE FROM declaraciones_iva;");

  // Read local sqlite data and upload
  const provRes = await localDb.execute("SELECT id, rif, razon_social, tipo_servicio, aplica_inventario FROM proveedores");
  for (const p of provRes.rows) {
    await turso.execute({
      sql: `INSERT INTO proveedores (id, rif, razon_social, tipo_servicio, aplica_inventario) 
            VALUES (?, ?, ?, ?, ?) 
            ON CONFLICT(id) DO UPDATE SET tipo_servicio = excluded.tipo_servicio, aplica_inventario = excluded.aplica_inventario;`,
      args: [p.id, p.rif, p.razon_social, p.tipo_servicio, p.aplica_inventario]
    });
  }
  console.log(`Proveedores sincronizados (${provRes.rows.length})`);

  // Sync Compras
  const comprasRes = await localDb.execute("SELECT * FROM libro_compras");
  for (const c of comprasRes.rows) {
    await turso.execute({
      sql: `INSERT INTO libro_compras (id, periodo, archivo_origen, nro_operacion, fecha, rif, razon_social, nro_factura, nro_control, tipo_transaccion, base_imponible_bs, alicuota, iva_bs, total_bs, iva_retenido_bs, proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, movimiento_id, observaciones_cruce)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.id, c.periodo, c.archivo_origen, c.nro_operacion, c.fecha, c.rif, c.razon_social, c.nro_factura, c.nro_control, c.tipo_transaccion, c.base_imponible_bs, c.alicuota, c.iva_bs, c.total_bs, c.iva_retenido_bs, c.proveedor_id, c.tipo_servicio, c.aplica_inventario, c.estatus_conciliacion, c.movimiento_id, c.observaciones_cruce]
    });
  }
  console.log(`Facturas de compra subidas a Turso Cloud (${comprasRes.rows.length})`);

  // Sync Ventas
  const ventasRes = await localDb.execute("SELECT * FROM libro_ventas");
  for (const v of ventasRes.rows) {
    await turso.execute({
      sql: `INSERT INTO libro_ventas (id, periodo, archivo_origen, fecha, factura_desde, factura_hasta, total_bs, exento_bs, base_imponible_bs, alicuota, iva_bs, cantidad_comprobantes, estatus_conciliacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [v.id, v.periodo, v.archivo_origen, v.fecha, v.factura_desde, v.factura_hasta, v.total_bs, v.exento_bs, v.base_imponible_bs, v.alicuota, v.iva_bs, v.cantidad_comprobantes, v.estatus_conciliacion]
    });
  }
  console.log(`Lotes de venta subidos a Turso Cloud (${ventasRes.rows.length})`);

  // Sync Declaraciones IVA
  const declRes = await localDb.execute("SELECT * FROM declaraciones_iva");
  for (const d of declRes.rows) {
    await turso.execute({
      sql: `INSERT INTO declaraciones_iva (id, periodo, archivo_origen, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs, total_compras_facturas, total_ventas_dias, estatus)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [d.id, d.periodo, d.archivo_origen, d.ventas_base_bs, d.debito_fiscal_bs, d.compras_base_bs, d.credito_fiscal_bs, d.total_compras_facturas, d.total_ventas_dias, d.estatus]
    });
  }
  console.log(`Resúmenes mensuales de IVA subidos a Turso Cloud (${declRes.rows.length})`);
  console.log('✅ TODA LA INFORMACIÓN FISCAL SINCRONIZADA CON ÉXITO EN TURSO CLOUD!');
}

syncToTurso().then(() => process.exit(0)).catch(err => {
  console.error('Error sincronizando:', err);
  process.exit(1);
});
