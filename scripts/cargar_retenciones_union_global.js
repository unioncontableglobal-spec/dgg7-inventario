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

const UCG_PROVEEDOR_ID = 36;
const UCG_RIF = 'J-50714716-9';
const UCG_RAZON = 'UNION GLOBAL 333, C.A.';
const UCG_DIR = 'ESQ. QUESERA A NIQUITAO, EDIF. PARQUE CARABOBO PLAZA, TORRE A PISO 15. APTO. 15A2 URB. SAN AGUSTIN DEL NORTE, CARACAS';
const UCG_TEL = '0212-5760000';
const UCG_EMAIL = 'facturacion@unioncontableglobal.com';

// 6 Comprobantes Oficiales cargados en RETENCIONES APLICADAS
const RETENCIONES_DATA = [
  {
    periodo: '2026-02',
    nro_comprobante: '20260100000003', // Correlativo oficial impreso en el comprobante
    fecha_emision: '28/02/2026',
    hora_emision: '15:30:00',
    nro_factura: '000006',
    nro_control: '00-00000007',
    fecha_factura: '28/02/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 104593.09,
    base_imponible_bs: 90166.46,
    monto_iva_bs: 14426.63,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 1803.33,
    total_a_pagar_bs: 102789.76,
    tasa_bcv: 417.3579,
    fecha_tasa_bcv: '2026-02-27',
    archivo_pdf: 'Retenciones ISLR DG67 - UCG FACT 00006 FEB26.pdf'
  },
  {
    periodo: '2026-03',
    nro_comprobante: '20260300000004',
    fecha_emision: '30/03/2026',
    hora_emision: '15:30:00',
    nro_factura: '000007',
    nro_control: '00-00000008',
    fecha_factura: '30/03/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 107915.24,
    base_imponible_bs: 93030.38,
    monto_iva_bs: 14884.86,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 1860.61,
    total_a_pagar_bs: 106054.63,
    tasa_bcv: 473.8702,
    fecha_tasa_bcv: '2026-03-31',
    archivo_pdf: 'Retencion ISLR 032026  SERVICIO UCG.pdf'
  },
  {
    periodo: '2026-04',
    nro_comprobante: '20260400000005',
    fecha_emision: '29/04/2026',
    hora_emision: '15:30:00',
    nro_factura: '000008',
    nro_control: '00-00000009',
    fecha_factura: '29/04/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 116030.79,
    base_imponible_bs: 100256.54,
    monto_iva_bs: 15774.25,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 2005.13,
    total_a_pagar_bs: 114025.66,
    tasa_bcv: 487.1192,
    fecha_tasa_bcv: '2026-04-30',
    archivo_pdf: 'RET ISRL DG67 - ABR26 - UCG.pdf'
  },
  {
    periodo: '2026-05',
    nro_comprobante: '20260500000006',
    fecha_emision: '30/05/2026',
    hora_emision: '15:30:00',
    nro_factura: '000010',
    nro_control: '00-00000011',
    fecha_factura: '30/04/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 128031.81,
    base_imponible_bs: 110375.70,
    monto_iva_bs: 17656.11,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 2207.51,
    total_a_pagar_bs: 125824.30,
    tasa_bcv: 549.3716,
    fecha_tasa_bcv: '2026-05-29',
    archivo_pdf: 'RETENCION ISRL - FACT 000010 - RECIBO # 088 - DG67- CFT ABR26.pdf'
  },
  {
    periodo: '2026-07',
    nro_comprobante: '20260700000007',
    fecha_emision: '31/07/2026',
    hora_emision: '15:30:00',
    nro_factura: '000011',
    nro_control: '00-00000012',
    fecha_factura: '31/07/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 202855.64,
    base_imponible_bs: 174875.55,
    monto_iva_bs: 27980.09,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 3497.51,
    total_a_pagar_bs: 199358.13,
    tasa_bcv: 746.6297,
    fecha_tasa_bcv: '2026-07-31',
    archivo_pdf: 'Retenciones ISLR 2026.xlsx.pdf'
  },
  {
    periodo: '2026-08',
    nro_comprobante: '20260800000008',
    fecha_emision: '29/08/2026',
    hora_emision: '15:30:00',
    nro_factura: '000012',
    nro_control: '00-00000013',
    fecha_factura: '29/08/2026',
    descripcion: 'ASESORIA 360 GLOBAL - CFT',
    total_documento_bs: 214966.70,
    base_imponible_bs: 185316.12,
    monto_iva_bs: 29650.58,
    alicuota: 0.16,
    pct_retencion_islr: 2.0,
    monto_retenido_islr_bs: 3706.32,
    total_a_pagar_bs: 211260.38,
    tasa_bcv: 794.9917,
    fecha_tasa_bcv: '2026-08-31',
    archivo_pdf: 'Retenciones DG67 ISLR 08-2026 UCG.xlsx.pdf'
  }
];

// Septiembre ya existente para preservar correlativo continuo
const SEPTIEMBRE_DATA = {
  periodo: '2026-09',
  nro_comprobante: '20260900000009', // o 20260900000007
  fecha_emision: '30/09/2026',
  hora_emision: '15:30:00',
  nro_factura: '000013',
  nro_control: '00-00000014',
  fecha_factura: '30/09/2026',
  descripcion: 'ASESORIA 360 GLOBAL - CFT',
  total_documento_bs: 230330.41,
  base_imponible_bs: 198560.70,
  monto_iva_bs: 31769.71,
  alicuota: 0.16,
  pct_retencion_islr: 2.0,
  monto_retenido_islr_bs: 3971.21,
  total_a_pagar_bs: 226359.20,
  tasa_bcv: 859.0629,
  fecha_tasa_bcv: '2026-09-30',
  archivo_pdf: 'Resumen IVA 09-2026 DG67 CA.xlsx'
};

async function syncRetenciones(db, label) {
  console.log(`\n======================================================`);
  console.log(`PROCESANDO RETENCIONES ISLR EN: ${label}`);
  console.log(`======================================================`);

  // 1. Limpiar retenciones obsoletas de Union Global
  await db.execute({
    sql: "DELETE FROM retenciones_islr_detalles WHERE retencion_id IN (SELECT id FROM retenciones_islr WHERE sujeto_rif = ?)",
    args: [UCG_RIF]
  });
  await db.execute({
    sql: "DELETE FROM retenciones_islr WHERE sujeto_rif = ?",
    args: [UCG_RIF]
  });
  console.log('  -> Tabla retenciones_islr y retenciones_islr_detalles depuradas para Union Global.');

  const allItems = [...RETENCIONES_DATA, SEPTIEMBRE_DATA];

  for (const item of allItems) {
    console.log(`\n  Procesando Comprobante ${item.nro_comprobante} - Período ${item.periodo} (Factura ${item.nro_factura})...`);

    // A. Asegurar/Actualizar factura en libro_compras
    const existFact = await db.execute({
      sql: "SELECT id FROM libro_compras WHERE periodo = ? AND (nro_factura = ? OR rif = ?)",
      args: [item.periodo, item.nro_factura, UCG_RIF]
    });

    let libroCompraId = null;
    const baseDiv = Number((item.base_imponible_bs / item.tasa_bcv).toFixed(2));
    const ivaDiv = Number((item.monto_iva_bs / item.tasa_bcv).toFixed(2));
    const totDiv = Number((item.total_documento_bs / item.tasa_bcv).toFixed(2));
    const islrDiv = Number((item.monto_retenido_islr_bs / item.tasa_bcv).toFixed(2));

    if (existFact.rows.length > 0) {
      libroCompraId = existFact.rows[0].id;
      console.log(`     -> Actualizando factura existente ID ${libroCompraId} en libro_compras...`);
      await db.execute({
        sql: `UPDATE libro_compras SET
                nro_factura = ?,
                nro_control = ?,
                fecha = ?,
                fecha_recepcion = ?,
                archivo_origen = ?,
                base_imponible_bs = ?,
                alicuota = ?,
                iva_bs = ?,
                total_bs = ?,
                tasa_bcv = ?,
                fecha_tasa_bcv = ?,
                base_imponible_divisa = ?,
                monto_iva_divisa = ?,
                total_divisa = ?,
                aplica_inventario = 0,
                tipo_servicio = 'SERVICIOS_CONTABLES_Y_LEGALES',
                estatus_conciliacion = 'NO_APLICA_GASTO',
                observaciones_cruce = ?
              WHERE id = ?`,
        args: [
          item.nro_factura,
          item.nro_control,
          item.fecha_factura.split('/').reverse().join('-'), // YYYY-MM-DD
          item.fecha_factura.split('/').reverse().join('-'),
          item.archivo_pdf,
          item.base_imponible_bs,
          item.alicuota,
          item.monto_iva_bs,
          item.total_documento_bs,
          item.tasa_bcv,
          item.fecha_tasa_bcv,
          baseDiv,
          ivaDiv,
          totDiv,
          `Factura oficial servicios Unión Global 333, C.A. con Retención ISLR 2% Comprobante ${item.nro_comprobante}`,
          libroCompraId
        ]
      });
    } else {
      console.log(`     -> Insertando factura faltante ${item.nro_factura} en libro_compras (Período ${item.periodo})...`);
      const insRes = await db.execute({
        sql: `INSERT INTO libro_compras (
                periodo, archivo_origen, nro_operacion, fecha, fecha_recepcion, rif, razon_social,
                nro_factura, nro_control, tipo_transaccion, base_imponible_bs, alicuota, iva_bs,
                total_bs, iva_retenido_bs, tasa_bcv, fecha_tasa_bcv, moneda_divisa,
                base_imponible_divisa, monto_iva_divisa, total_divisa, iva_retenido_divisa,
                proveedor_id, tipo_servicio, aplica_inventario, estatus_conciliacion, observaciones_cruce
              ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, '01-reg', ?, ?, ?, ?, 0.0, ?, ?, 'USD', ?, ?, ?, 0.0, ?, 'SERVICIOS_CONTABLES_Y_LEGALES', 0, 'NO_APLICA_GASTO', ?)`,
        args: [
          item.periodo,
          item.archivo_pdf,
          item.fecha_factura.split('/').reverse().join('-'),
          item.fecha_factura.split('/').reverse().join('-'),
          UCG_RIF,
          UCG_RAZON,
          item.nro_factura,
          item.nro_control,
          item.base_imponible_bs,
          item.alicuota,
          item.monto_iva_bs,
          item.total_documento_bs,
          item.tasa_bcv,
          item.fecha_tasa_bcv,
          baseDiv,
          ivaDiv,
          totDiv,
          UCG_PROVEEDOR_ID,
          `Factura oficial servicios Unión Global 333, C.A. con Retención ISLR 2% Comprobante ${item.nro_comprobante}`
        ]
      });
      libroCompraId = Number(insRes.lastInsertRowid);
    }

    // B. Insertar cabecera de retención en retenciones_islr
    const insRetRes = await db.execute({
      sql: `INSERT INTO retenciones_islr (
              nro_comprobante, periodo, fecha_emision, hora_emision, proveedor_id,
              sujeto_rif, sujeto_razon_social, sujeto_tipo_persona, sujeto_direccion,
              sujeto_email, sujeto_telefono, concepto_general, codigo_concepto_principal,
              es_multimoneda, moneda_divisa, tasa_bcv, valor_ut_aplicado,
              total_documento_bs, total_base_imponible_bs, total_sustraendo_bs,
              total_islr_retenido_bs, total_a_pagar_bs, estatus, observaciones
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PJ-D', ?, ?, ?, 'ASESORIA ADMINISTRATIVA', '055', 1, 'USD', ?, 43.00, ?, ?, 0.0, ?, ?, 'EMITIDO', ?)`,
      args: [
        item.nro_comprobante,
        item.periodo,
        item.fecha_emision,
        item.hora_emision,
        UCG_PROVEEDOR_ID,
        UCG_RIF,
        UCG_RAZON,
        UCG_DIR,
        UCG_EMAIL,
        UCG_TEL,
        item.tasa_bcv,
        item.total_documento_bs,
        item.base_imponible_bs,
        item.monto_retenido_islr_bs,
        item.total_a_pagar_bs,
        item.descripcion
      ]
    });
    const retencionId = Number(insRetRes.lastInsertRowid);

    // C. Insertar renglón en retenciones_islr_detalles
    await db.execute({
      sql: `INSERT INTO retenciones_islr_detalles (
              retencion_id, libro_compra_id, nro_operacion, fecha_factura, nro_factura, nro_control,
              nro_nota_debito, nro_nota_credito, tipo_transaccion, codigo_concepto, descripcion_concepto,
              monto_total_bs, base_imponible_bs, pct_base, pct_tarifa, sustraendo_bs, impuesto_retenido_bs,
              tasa_bcv_linea, precio_unitario_bs, precio_unitario_divisa, base_imponible_divisa,
              monto_iva_bs, monto_iva_divisa, total_linea_bs, total_linea_divisa, impuesto_retenido_divisa
            ) VALUES (?, ?, 1, ?, ?, ?, '', '', '01-REG', '055', ?, ?, ?, 100.0, ?, 0.0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        retencionId,
        libroCompraId,
        item.fecha_factura,
        item.nro_factura,
        item.nro_control,
        item.descripcion,
        item.total_documento_bs,
        item.base_imponible_bs,
        item.pct_retencion_islr,
        item.monto_retenido_islr_bs,
        item.tasa_bcv,
        item.base_imponible_bs,
        baseDiv,
        baseDiv,
        item.monto_iva_bs,
        ivaDiv,
        item.total_documento_bs,
        totDiv,
        islrDiv
      ]
    });

    console.log(`     -> Comprobante ${item.nro_comprobante} guardado exitosamente con factura vinculada ID ${libroCompraId}.`);

    // D. Recalcular Declaración de IVA Forma 30 para el período
    await recalculateForma30(db, item.periodo);
  }

  // Verificación final
  const listRet = await db.execute("SELECT id, nro_comprobante, periodo, fecha_emision, total_base_imponible_bs, total_islr_retenido_bs FROM retenciones_islr ORDER BY periodo ASC");
  console.log('\n  [VERIFICACIÓN RETENCIONES REGISTRADAS]:');
  console.table(listRet.rows);
}

async function recalculateForma30(db, periodo) {
  try {
    const vRes = await db.execute({
      sql: "SELECT COALESCE(SUM(base_imponible_bs), 0) as v_base, COALESCE(SUM(iva_bs), 0) as v_iva, COUNT(*) as v_dias FROM libro_ventas WHERE periodo = ?",
      args: [periodo]
    });
    const cRes = await db.execute({
      sql: "SELECT COALESCE(SUM(base_imponible_bs), 0) as c_base, COALESCE(SUM(iva_bs), 0) as c_iva, COALESCE(SUM(iva_retenido_bs), 0) as c_ret, COUNT(*) as c_facs FROM libro_compras WHERE periodo = ?",
      args: [periodo]
    });

    const vBase = Number(vRes.rows[0]?.v_base || 0);
    const vIva = Number(vRes.rows[0]?.v_iva || 0);
    const vDias = Number(vRes.rows[0]?.v_dias || 0);
    const cBase = Number(cRes.rows[0]?.c_base || 0);
    const cIva = Number(cRes.rows[0]?.c_iva || 0);
    const cRet = Number(cRes.rows[0]?.c_ret || 0);
    const cFacs = Number(cRes.rows[0]?.c_facs || 0);

    const prevRes = await db.execute({
      sql: "SELECT excedente_siguiente_bs FROM declaraciones_iva WHERE periodo < ? ORDER BY periodo DESC LIMIT 1",
      args: [periodo]
    });
    const excAnt = Number(prevRes.rows[0]?.excedente_siguiente_bs || 0);
    const credTot = cIva + excAnt;
    let aPagar = 0.0, excSig = 0.0;
    if (vIva > credTot) {
      aPagar = Number((vIva - credTot).toFixed(2));
      excSig = 0.0;
    } else {
      aPagar = 0.0;
      excSig = Number((credTot - vIva).toFixed(2));
    }

    await db.execute({
      sql: `INSERT INTO declaraciones_iva (
              periodo, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
              iva_retenido_bs, total_compras_facturas, total_ventas_dias, estatus,
              excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DECLARADO', ?, ?, ?)
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
      args: [periodo, vBase, vIva, cBase, cIva, cRet, cFacs, vDias, excAnt, excSig, aPagar]
    });
  } catch (err) {
    console.warn(`  Aviso recalculando IVA ${periodo}:`, err.message);
  }
}

async function run() {
  try {
    await syncRetenciones(localDb, 'BASE DE DATOS LOCAL (inventario_dg67.db)');
    if (remoteDb) {
      await syncRetenciones(remoteDb, 'BASE DE DATOS TURSO CLOUD');
    }
    console.log('\n======================================================');
    console.log('TODAS LAS RETENCIONES Y FACTURAS FUERON CARGADAS CON ÉXITO.');
    console.log('======================================================');
  } catch (err) {
    console.error('Error sincronizando retenciones:', err);
    process.exit(1);
  }
}

run();

