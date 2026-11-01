import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const localDb = createClient({
  url: 'file:inventario_dg67.db'
});

const remoteUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
let remoteDb = null;
if (remoteUrl && authToken) {
  remoteDb = createClient({ url: remoteUrl, authToken });
}

async function ensureColumns(db, tableName) {
  try {
    const info = await db.execute(`PRAGMA table_info(${tableName})`);
    const colNames = info.rows.map(r => r.name);

    const requiredCols = [
      { name: 'tasa_bcv', type: 'REAL DEFAULT 68.50' },
      { name: 'fecha_tasa_bcv', type: "TEXT DEFAULT ''" },
      { name: 'moneda_divisa', type: "TEXT DEFAULT 'USD'" },
      { name: 'base_imponible_divisa', type: 'REAL DEFAULT 0.0' },
      { name: 'monto_iva_divisa', type: 'REAL DEFAULT 0.0' },
      { name: 'total_divisa', type: 'REAL DEFAULT 0.0' },
      { name: 'iva_retenido_divisa', type: 'REAL DEFAULT 0.0' },
      { name: 'fecha_recepcion', type: "TEXT DEFAULT ''" }
    ];

    for (const col of requiredCols) {
      if (!colNames.includes(col.name)) {
        console.log(`  -> Agregando columna faltante ${col.name} a ${tableName}`);
        try {
          await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`);
        } catch (err) {
          console.warn(`     Aviso al agregar ${col.name}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.warn(`No se pudo verificar PRAGMA table_info para ${tableName}:`, err.message);
  }
}

async function updateDb(db, label) {
  console.log(`\n========================================`);
  console.log(`PROCESANDO: ${label}`);
  console.log(`========================================`);

  await ensureColumns(db, 'libro_compras');

  // 1. Eliminar filas sintéticas anteriores del período 2026-01
  const delRes = await db.execute({
    sql: "DELETE FROM libro_compras WHERE periodo = ?",
    args: ['2026-01']
  });
  console.log(`  -> Eliminadas ${delRes.rowsAffected ?? 'todas las'} filas anteriores de libro_compras (2026-01).`);

  // 2. Insertar la factura fiscal real oficial del SENIAT (L.Compras 1-2026 DG67 CA.pdf)
  // Proveedor: Union Global 333, C.A. (J-50714716-9)
  // Factura: 000005, Control: 00-00000006, Fecha: 31/01/2026
  // Base Imponible: 44.046,38 Bs. | IVA 16%: 7.047,42 Bs. | Total: 51.093,80 Bs.
  // Tasa BCV Oficial Cierre Enero 2026: 367,3069 Bs/USD (30/01/2026)
  // Contravalor USD: Base $119.92 | IVA $19.19 | Total $139.10
  const insertSql = `
    INSERT INTO libro_compras (
      periodo, archivo_origen, nro_operacion, fecha, fecha_recepcion, rif, razon_social,
      nro_factura, nro_control, tipo_transaccion, base_imponible_bs, alicuota, iva_bs,
      total_bs, iva_retenido_bs, tasa_bcv, fecha_tasa_bcv, moneda_divisa,
      base_imponible_divisa, monto_iva_divisa, total_divisa, iva_retenido_divisa,
      proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion,
      movimiento_id, observaciones_cruce
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `;

  const insertArgs = [
    '2026-01',
    'L.Compras 1-2026 DG67 CA.pdf',
    1,
    '2026-01-31',
    '2026-01-31',
    'J-50714716-9',
    'Union Global 333, C.A.',
    '000005',
    '00-00000006',
    '01-reg',
    44046.38,
    0.16,
    7047.42,
    51093.80,
    0.00,
    367.3069,
    '2026-01-30',
    'USD',
    119.92,
    19.19,
    139.10,
    0.00,
    36,
    'SERVICIOS_CONTABLES_Y_LEGALES',
    0,
    'NO_APLICA_GASTO',
    null,
    'Factura fiscal oficial declarada al SENIAT (L.Compras 1-2026 DG67 CA.pdf) - Servicios Contables Unión Global 333, C.A.'
  ];

  await db.execute({ sql: insertSql, args: insertArgs });
  console.log(`  -> Insertada factura oficial SENIAT N° 000005 de Union Global 333, C.A. en libro_compras.`);

  // 3. Recalcular / Actualizar Declaración de IVA Forma 30 período 2026-01
  // Ventas Base: 439.066,22 Bs. | Débito Fiscal: 70.250,60 Bs. (21 días de venta)
  // Compras Base: 44.046,38 Bs. | Crédito Fiscal: 7.047,42 Bs. (1 factura)
  // Total a pagar: 70.250,60 - 7.047,42 = 63.203,18 Bs.
  const updateDeclSql = `
    INSERT INTO declaraciones_iva (
      periodo, archivo_origen, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
      iva_retenido_bs, total_compras_facturas, total_ventas_dias, estatus,
      excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs
    ) VALUES (
      '2026-01', 'L.Compras 1-2026 DG67 CA.pdf', 439066.22, 70250.60, 44046.38, 7047.42,
      0.00, 1, 21, 'DECLARADO',
      0.00, 0.00, 63203.18
    )
    ON CONFLICT(periodo) DO UPDATE SET
      archivo_origen = excluded.archivo_origen,
      ventas_base_bs = excluded.ventas_base_bs,
      debito_fiscal_bs = excluded.debito_fiscal_bs,
      compras_base_bs = excluded.compras_base_bs,
      credito_fiscal_bs = excluded.credito_fiscal_bs,
      iva_retenido_bs = excluded.iva_retenido_bs,
      total_compras_facturas = excluded.total_compras_facturas,
      total_ventas_dias = excluded.total_ventas_dias,
      estatus = excluded.estatus,
      excedente_anterior_bs = excluded.excedente_anterior_bs,
      excedente_siguiente_bs = excluded.excedente_siguiente_bs,
      total_a_pagar_bs = excluded.total_a_pagar_bs
  `;

  await db.execute(updateDeclSql);
  console.log(`  -> Declaración de IVA (Forma 30) período 2026-01 actualizada.`);

  // 4. Verificación
  const verifyCompras = await db.execute({
    sql: "SELECT id, periodo, rif, razon_social, nro_factura, nro_control, base_imponible_bs, iva_bs, total_bs, tasa_bcv, total_divisa FROM libro_compras WHERE periodo = ?",
    args: ['2026-01']
  });
  console.log(`\n  [Verificación Compras 2026-01]:`, verifyCompras.rows);

  const verifyDecl = await db.execute({
    sql: "SELECT periodo, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs, total_compras_facturas, total_a_pagar_bs FROM declaraciones_iva WHERE periodo = ?",
    args: ['2026-01']
  });
  console.log(`  [Verificación Declaración 2026-01]:`, verifyDecl.rows);
}

async function run() {
  try {
    await updateDb(localDb, 'BASE DE DATOS LOCAL (inventario_dg67.db)');
    if (remoteDb) {
      await updateDb(remoteDb, 'BASE DE DATOS TURSO CLOUD');
    } else {
      console.log('\n(No se configuró Turso remoto, solo se actualizó la BD local)');
    }
    console.log('\nACTUALIZACIÓN COMPLETADA CON ÉXITO.');
  } catch (err) {
    console.error('Error durante la actualización:', err);
    process.exit(1);
  }
}

run();
