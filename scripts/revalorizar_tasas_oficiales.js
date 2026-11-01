import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const localDb = createClient({ url: 'file:inventario_dg67.db' });
const remoteDb = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : null;

const TASAS_OFICIALES = [
  { periodo: '2025-12', fecha: '2025-12-30', tasa: 298.1431 },
  { periodo: '2026-01', fecha: '2026-01-30', tasa: 367.3069 },
  { periodo: '2026-02', fecha: '2026-02-27', tasa: 417.3579 },
  { periodo: '2026-03', fecha: '2026-03-31', tasa: 473.8702 },
  { periodo: '2026-04', fecha: '2026-04-30', tasa: 487.1192 },
  { periodo: '2026-05', fecha: '2026-05-29', tasa: 549.3716 },
  { periodo: '2026-06', fecha: '2026-06-30', tasa: 623.0223 },
  { periodo: '2026-07', fecha: '2026-07-31', tasa: 746.6297 },
  { periodo: '2026-08', fecha: '2026-08-31', tasa: 794.9917 },
  { periodo: '2026-09', fecha: '2026-09-30', tasa: 859.0629 },
  { periodo: '2026-10', fecha: '2026-10-30', tasa: 889.5800 }
];

async function run() {
  console.log('=== APLICANDO TASAS OFICIALES BCV DE CIERRE MENSUAL ===');

  for (const t of TASAS_OFICIALES) {
    console.log(`Período ${t.periodo}: Fecha ${t.fecha} | Tasa BCV: ${t.tasa.toFixed(4)} Bs/USD`);

    // 1. Guardar en tasas_bcv_periodo
    const sqlTasa = `
      INSERT INTO tasas_bcv_periodo (periodo, tasa_bcv, fecha_cierre, moneda, fuente)
      VALUES (?, ?, ?, 'USD', 'BCV Oficial Cierre Mensual')
      ON CONFLICT(periodo) DO UPDATE SET
        tasa_bcv = excluded.tasa_bcv,
        fecha_cierre = excluded.fecha_cierre,
        fuente = excluded.fuente
    `;
    await localDb.execute({ sql: sqlTasa, args: [t.periodo, t.tasa, t.fecha] });
    if (remoteDb) await remoteDb.execute({ sql: sqlTasa, args: [t.periodo, t.tasa, t.fecha] }).catch((e) => console.warn('Turso tasa warn:', e.message));

    // 2. Revalorizar Movimientos del período
    const sqlMovs = `
      UPDATE movimientos
      SET tasa_bcv = ?, fecha_tasa_bcv = ?
      WHERE strftime('%Y-%m', fecha) = ?
    `;
    await localDb.execute({ sql: sqlMovs, args: [t.tasa, t.fecha, t.periodo] });
    if (remoteDb) await remoteDb.execute({ sql: sqlMovs, args: [t.tasa, t.fecha, t.periodo] }).catch(() => {});

    // 3. Revalorizar Detalles de Movimientos (Kardex: Costos y Precios en Bs)
    const sqlDet = `
      UPDATE movimiento_detalles
      SET 
        tasa_bcv_operacion = ?,
        costo_unitario_divisa = COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0),
        costo_unitario_bs = ROUND(COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0) * ?, 2),
        costo_unitario_ves = ROUND(COALESCE(NULLIF(costo_unitario_divisa, 0), costo_unitario_usd, 0) * ?, 2),
        precio_unitario_bs = ROUND(COALESCE(precio_unitario_divisa, 0) * ?, 2),
        base_imponible_bs = ROUND(COALESCE(base_imponible_divisa, (cantidad * COALESCE(precio_unitario_divisa, 0)), 0) * ?, 2),
        total_linea_bs = ROUND(COALESCE(total_linea_divisa, (cantidad * COALESCE(precio_unitario_divisa, 0)), 0) * ?, 2)
      WHERE movimiento_id IN (SELECT id FROM movimientos WHERE strftime('%Y-%m', fecha) = ?)
    `;
    await localDb.execute({ sql: sqlDet, args: [t.tasa, t.tasa, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] });
    if (remoteDb) await remoteDb.execute({ sql: sqlDet, args: [t.tasa, t.tasa, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] }).catch(() => {});

    // 4. Revalorizar Libro de Compras (Divisa = Bs / Tasa)
    const sqlCompras = `
      UPDATE libro_compras
      SET 
        tasa_bcv = ?,
        fecha_tasa_bcv = ?,
        base_imponible_divisa = ROUND(COALESCE(base_imponible_bs, 0) / ?, 2),
        monto_iva_divisa = ROUND(COALESCE(iva_bs, 0) / ?, 2),
        total_divisa = ROUND(COALESCE(total_bs, 0) / ?, 2),
        iva_retenido_divisa = ROUND(COALESCE(iva_retenido_bs, 0) / ?, 2)
      WHERE periodo = ?
    `;
    await localDb.execute({ sql: sqlCompras, args: [t.tasa, t.fecha, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] });
    if (remoteDb) await remoteDb.execute({ sql: sqlCompras, args: [t.tasa, t.fecha, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] }).catch(() => {});

    // 5. Revalorizar Libro de Ventas (Divisa = Bs / Tasa)
    const sqlVentas = `
      UPDATE libro_ventas
      SET 
        tasa_bcv = ?,
        fecha_tasa_bcv = ?,
        exento_divisa = ROUND(COALESCE(exento_bs, 0) / ?, 2),
        base_imponible_divisa = ROUND(COALESCE(base_imponible_bs, 0) / ?, 2),
        monto_iva_divisa = ROUND(COALESCE(iva_bs, 0) / ?, 2),
        total_divisa = ROUND(COALESCE(total_bs, 0) / ?, 2)
      WHERE periodo = ?
    `;
    await localDb.execute({ sql: sqlVentas, args: [t.tasa, t.fecha, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] });
    if (remoteDb) await remoteDb.execute({ sql: sqlVentas, args: [t.tasa, t.fecha, t.tasa, t.tasa, t.tasa, t.tasa, t.periodo] }).catch(() => {});
  }

  console.log('=== REVALORIZACIÓN EXITOSA COMPLETADA ===');
}

run().catch(console.error);
