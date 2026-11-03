import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://inventario-dg67-unioncontableglobal-spec.aws-us-east-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTI3NzEzNTEsImlkIjoiMDFhMTY5N2YtYTAwMS03MjNlLWI5NTYtNWExYjA0Yjk2OGI5Iiwia2lkIjoiUVl1M2JpWWk5QUZtZXY4TmZod0x4Z0FDMG9RQ0VGNXBfemt5MmxMZHdkVSIsInJpZCI6ImM4YzJkOTQzLTFmMjctNDBkYi1iNTk1LTI1OTAyNGRkYzUzOSJ9.kYMvoWFHgysur-aq2okfAawMCpTmjCa8wld7JH9kkN9esWS9sZSRNMU0RfnUABAr9mq_WHBw2_ps2LueRoH-Aw';

const localDb = createClient({ url: 'file:inventario_dg67.db' });
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

async function sync() {
  console.log('--- SINCRONIZANDO MOVIMIENTOS Y PRODUCTOS A TURSO CLOUD ---');

  // 1. Sincronizar productos faltantes (698, 599)
  const localProds = await localDb.execute('SELECT * FROM productos');
  const tursoProds = await turso.execute('SELECT codigo FROM productos');
  const tursoCodes = new Set(tursoProds.rows.map(p => String(p.codigo).trim().toUpperCase()));

  for (const p of localProds.rows) {
    const code = String(p.codigo).trim().toUpperCase();
    if (!tursoCodes.has(code)) {
      await turso.execute({
        sql: `INSERT INTO productos (id, codigo, descripcion, categoria_id, almacen_id, unidad_medida, stock_minimo, costo_referencial_usd, activo)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [p.id, p.codigo, p.descripcion, p.categoria_id, p.almacen_id, p.unidad_medida, p.stock_minimo, p.costo_referencial_usd, p.activo]
      });
      console.log(`+ Sincronizado producto a Turso: ${p.codigo} - ${p.descripcion}`);
    }
  }

  // 2. Limpiar movimientos de Sep y Oct en Turso para reinsertar limpios
  await turso.execute(`
    DELETE FROM movimiento_detalles 
    WHERE movimiento_id IN (SELECT id FROM movimientos WHERE fecha >= '2026-09-01')
  `);
  await turso.execute(`DELETE FROM movimientos WHERE fecha >= '2026-09-01'`);
  console.log('Limpiados movimientos previos de Sep y Oct en Turso (si existían)');

  // 3. Sincronizar movimientos de Sep y Oct desde local
  const movsToSync = await localDb.execute(`
    SELECT * FROM movimientos WHERE fecha >= '2026-09-01' ORDER BY id ASC
  `);
  console.log(`Movimientos a sincronizar: ${movsToSync.rows.length}`);

  for (const m of movsToSync.rows) {
    await turso.execute({
      sql: `INSERT INTO movimientos (
              id, tipo, fecha, numero_documento, proveedor_id, observaciones,
              creado_en, subtipo, nro_control, usuario_responsable, documento_afectado,
              tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion, fecha_factura, tasa_bcv_factura
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        m.id, m.tipo, m.fecha, m.numero_documento, m.proveedor_id, m.observaciones,
        m.creado_en, m.subtipo, m.nro_control, m.usuario_responsable, m.documento_afectado,
        m.tasa_bcv, m.fecha_tasa_bcv, m.moneda_operacion, m.metodo_valoracion, m.fecha_factura, m.tasa_bcv_factura
      ]
    });
  }

  // 4. Sincronizar detalles de Sep y Oct
  const detsToSync = await localDb.execute(`
    SELECT md.* FROM movimiento_detalles md
    JOIN movimientos m ON md.movimiento_id = m.id
    WHERE m.fecha >= '2026-09-01'
    ORDER BY md.id ASC
  `);
  console.log(`Detalles a sincronizar: ${detsToSync.rows.length}`);

  // Batch insert en lotes de 50 para rapidez
  const batchSize = 50;
  for (let i = 0; i < detsToSync.rows.length; i += batchSize) {
    const chunk = detsToSync.rows.slice(i, i + batchSize);
    for (const d of chunk) {
      await turso.execute({
        sql: `INSERT INTO movimiento_detalles (
                id, movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves,
                cpp_usd, cpp_ves, costo_unitario_divisa, tasa_bcv_operacion, costo_unitario_bs,
                precio_unitario_bs, precio_unitario_divisa, base_imponible_bs, base_imponible_divisa,
                monto_iva_bs, monto_iva_divisa, total_linea_bs, total_linea_divisa
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          d.id, d.movimiento_id, d.producto_id, d.cantidad, d.costo_unitario_usd, d.costo_unitario_ves,
          d.cpp_usd, d.cpp_ves, d.costo_unitario_divisa, d.tasa_bcv_operacion, d.costo_unitario_bs,
          d.precio_unitario_bs, d.precio_unitario_divisa, d.base_imponible_bs, d.base_imponible_divisa,
          d.monto_iva_bs, d.monto_iva_divisa, d.total_linea_bs, d.total_linea_divisa
        ]
      });
    }
    console.log(`  Progreso: ${Math.min(i + batchSize, detsToSync.rows.length)} / ${detsToSync.rows.length} detalles`);
  }

  // 5. Verificar recuento en Turso
  const checkTurso = await turso.execute(`
    SELECT 
      substr(fecha, 1, 7) as mes,
      count(*) as cant_movs
    FROM movimientos
    GROUP BY mes
    ORDER BY mes ASC
  `);
  console.log('\n--- Estado Final de Movimientos en Turso Cloud: ---');
  console.table(checkTurso.rows);
}

sync().catch(console.error);

