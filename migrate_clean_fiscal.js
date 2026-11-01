import { createClient } from '@libsql/client';
import xlsxPkg from 'xlsx';
const XLSX = xlsxPkg.readFile ? xlsxPkg : (xlsxPkg.default || xlsxPkg);
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'inventario_dg67.db');
const localDb = createClient({ url: 'file:' + dbPath });

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
const tursoDb = (tursoUrl && tursoToken) ? createClient({ url: tursoUrl, authToken: tursoToken }) : null;

const folder = path.join(__dirname, 'DECLARACIONES MENSUALES');
const files = fs.readdirSync(folder).filter(f => f.endsWith('.xlsx') && !f.startsWith('~')).sort();

/**
 * Convierte fechas de Excel o cadenas DD/MM/YYYY a YYYY-MM-DD,
 * corrigiendo el error de auto-incremento de mes de Excel cuando el usuario arrastró 01/03/2026
 * con formato americano (que generó 03/01/2026=46025, 03/02/2026=46056, etc.).
 */
function parseSalesDate(val, periodo, rowOffset) {
  if (!val) return null;
  const [yearStr, monthStr] = periodo.split('-');
  const targetMonth = parseInt(monthStr, 10);

  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    const iso = d.toISOString().split('T')[0];
    const [y, m, day] = iso.split('-').map(Number);

    // Si la fecha serial cae exactamente en el mes del periodo, la usamos directo
    if (y === 2026 && m === targetMonth) {
      return iso;
    }
    // Si el día del serial coincide con el número de mes (ej. día=3 en Marzo, día=4 en Abril, día=5 en Mayo)
    // significa que Excel invirtió Día/Mes al arrastrar la serie (mes=m pasa a ser el día real!)
    if (y === 2026 && day === targetMonth && m >= 1 && m <= 12) {
      return `2026-${String(targetMonth).padStart(2, '0')}-${String(m).padStart(2, '0')}`;
    }
    return iso;
  }

  const s = String(val).trim();
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      let dPart = parts[0].padStart(2, '0');
      let mPart = parts[1].padStart(2, '0');
      let yPart = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${yPart}-${mPart}-${dPart}`;
    }
  }
  return s.split(' ')[0].split('T')[0];
}

function parsePurchaseDate(val, periodo) {
  if (!val) return `${periodo}-01`;
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      let dPart = parts[0].padStart(2, '0');
      let mPart = parts[1].padStart(2, '0');
      let yPart = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${yPart}-${mPart}-${dPart}`;
    }
  }
  return s.split(' ')[0].split('T')[0];
}

function classifyProvider(rif, razon) {
  const rUp = (razon || '').toUpperCase();
  if (rUp.includes('UNION GLOBAL') || rUp.includes('CONTABLE') || rUp.includes('ASESOR')) {
    return { tipo: 'SERVICIOS_CONTABLES_Y_LEGALES', aplica: 0 };
  } else if (rUp.includes('MAQUINAS FISCALES') || rUp.includes('PED SOLUTIONS') || rUp.includes('LIFT CONTROL') || rUp.includes('SERVI-COM')) {
    return { tipo: 'SERVICIOS_TECNICOS_Y_SISTEMAS', aplica: 0 };
  } else if (rUp.includes('RESTAURANTES') || rUp.includes('KFC') || rUp.includes('LICORERIA')) {
    return { tipo: 'GASTOS_CONSUMO_ALIMENTOS', aplica: 0 };
  } else if (rUp.includes('DAKA')) {
    return { tipo: 'ACTIVO_FIJO_EQUIPOS', aplica: 0 };
  } else if (rUp.includes('EPA') || rUp.includes('FERRETERIA HERMANOS') || rUp.includes('FERRECONOMICA')) {
    return { tipo: 'GASTOS_MANTENIMIENTO_FERRETERIA', aplica: 0 };
  } else if (rUp.includes('LA ELECTRICA') || rUp.includes('TIENDAS LBN')) {
    return { tipo: 'GASTOS_OPERATIVOS_VARIOS', aplica: 0 };
  } else {
    return { tipo: 'MERCANCIA_REPUESTOS', aplica: 1 };
  }
}

/**
 * Extrae con exactitud matemática los valores oficiales de la hoja 'RESUMEN IVA' (Forma 30) de cada Excel.
 */
function parseResumenIvaSheet(wb) {
  const rSheetName = wb.SheetNames.find(s => s.toUpperCase().includes('RESUMEN'));
  if (!rSheetName) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[rSheetName], { header: 1 });

  let ventasNoGravadas = 0;
  let ventasBase = 0;
  let debitoFiscal = 0;
  let comprasNoGravadas = 0;
  let comprasBase = 0;
  let creditoFiscal = 0;
  let excedenteAnterior = 0;
  let totalCreditosFiscales = 0;
  let impuestoPeriodo = 0;
  let excedenteSiguiente = 0;
  let retencionesPeriodo = 0;
  let totalAPagar = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = String(row[0] || '').trim().toUpperCase();
    if (!label) continue;

    if (label.includes('VENTAS INTERNAS NO GRAVADAS')) {
      ventasNoGravadas = Number(row[4] || 0);
    } else if (label === 'TOTAL VENTAS Y DEBITOS FISCALES') {
      ventasBase = Number(row[4] || 0);
      debitoFiscal = Number(row[5] || 0);
    } else if (label === 'TOTAL COMPRAS Y CREDITOS FISCALES') {
      comprasBase = Number(row[4] || 0);
      creditoFiscal = Number(row[5] || 0);
    } else if (label.includes('EXCEDENTE DE CREDITOS FISCALES DEL MES ANTERIOR')) {
      excedenteAnterior = Number(row[5] || 0);
    } else if (label === 'TOTAL CREDITOS FISCALES') {
      totalCreditosFiscales = Number(row[5] || 0);
    } else if (label === 'IMPUESTO DEL PERIODO') {
      impuestoPeriodo = Math.max(0, Number(row[5] || 0));
    } else if (label.includes('EXCEDENTE DE CREDITOS FISCALES PARA MES SIGUIENTE')) {
      const val = Number(row[5] || 0);
      excedenteSiguiente = val > 0 ? val : 0;
    } else if (label.includes('RETENCIONES DEL PERIODO')) {
      retencionesPeriodo = Number(row[4] || row[5] || 0);
    } else if (label === 'TOTAL A PAGAR') {
      totalAPagar = Math.max(0, Number(row[5] || 0));
    }
  }

  return {
    ventasNoGravadas: Number(ventasNoGravadas.toFixed(2)),
    ventasBase: Number(ventasBase.toFixed(2)),
    debitoFiscal: Number(debitoFiscal.toFixed(2)),
    comprasNoGravadas: Number(comprasNoGravadas.toFixed(2)),
    comprasBase: Number(comprasBase.toFixed(2)),
    creditoFiscal: Number(creditoFiscal.toFixed(2)),
    excedenteAnterior: Number(excedenteAnterior.toFixed(2)),
    totalCreditosFiscales: Number(totalCreditosFiscales.toFixed(2)),
    impuestoPeriodo: Number(impuestoPeriodo.toFixed(2)),
    excedenteSiguiente: Number(excedenteSiguiente.toFixed(2)),
    retencionesPeriodo: Number(retencionesPeriodo.toFixed(2)),
    totalAPagar: Number(totalAPagar.toFixed(2))
  };
}

async function migrate() {
  console.log('=== AUDITORÍA E IMPORTACIÓN FISCAL EXACTA (ENERO A SEPTIEMBRE 2026 + OCTUBRE MANUAL) ===');

  for (const client of [localDb, tursoDb].filter(Boolean)) {
    try { await client.execute("ALTER TABLE declaraciones_iva ADD COLUMN excedente_anterior_bs REAL DEFAULT 0.0"); } catch (e) {}
    try { await client.execute("ALTER TABLE declaraciones_iva ADD COLUMN excedente_siguiente_bs REAL DEFAULT 0.0"); } catch (e) {}
    try { await client.execute("ALTER TABLE declaraciones_iva ADD COLUMN total_a_pagar_bs REAL DEFAULT 0.0"); } catch (e) {}
    try { await client.execute("ALTER TABLE proveedores ADD COLUMN telefono TEXT"); } catch (e) {}
    try { await client.execute("ALTER TABLE proveedores ADD COLUMN email TEXT"); } catch (e) {}
    try { await client.execute("ALTER TABLE proveedores ADD COLUMN porcentaje_retencion REAL DEFAULT 75.0"); } catch (e) {}
  }

  // Limpiar las tablas fiscales para reconstruirlas sin duplicados ni filas de totales falsas
  for (const client of [localDb, tursoDb].filter(Boolean)) {
    await client.execute("DELETE FROM libro_compras");
    await client.execute("DELETE FROM libro_ventas");
    await client.execute("DELETE FROM declaraciones_iva");
  }

  let provRes = await localDb.execute("SELECT id, rif, razon_social FROM proveedores");
  const provMap = new Map();
  provRes.rows.forEach(p => {
    if (p.rif) provMap.set(String(p.rif).trim().toUpperCase(), p.id);
  });

  // Ordenar archivos por número de mes (01 a 09)
  const sortedFiles = [...files].sort((a, b) => {
    const mA = parseInt(a.replace('Resumen IVA ', '').split('-')[0], 10);
    const mB = parseInt(b.replace('Resumen IVA ', '').split('-')[0], 10);
    return mA - mB;
  });

  let ultimoExcedenteSiguiente = 0.0;

  for (const fname of sortedFiles) {
    const parts = fname.replace('Resumen IVA ', '').replace(' DG67 CA 2.xlsx', '').replace(' DG67 CA.xlsx', '').split('-');
    const mesNum = parseInt(parts[0], 10);
    const periodo = `2026-${String(mesNum).padStart(2, '0')}`;
    const fpath = path.join(folder, fname);
    console.log(`\n📄 Auditando e importando período ${periodo} desde: ${fname}`);

    const wb = XLSX.readFile(fpath);
    const resumenOficial = parseResumenIvaSheet(wb);

    // 1. LIBRO DE COMPRAS (solo filas de facturas reales antes de "Totales" / "AJUSTES")
    const cSheetName = wb.SheetNames.find(s => s.toUpperCase().includes('COMPRAS'));
    let comprasPeriodo = [];
    let totComprasBase = 0;
    let totComprasIva = 0;

    if (cSheetName) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[cSheetName], { header: 1 });
      for (let r = 7; r < data.length; r++) {
        const row = data[r] || [];
        const col0Str = String(row[0] || '').trim().toUpperCase();
        const col13Str = String(row[13] || '').trim().toUpperCase();
        const col17Str = String(row[17] || '').trim().toUpperCase();

        // Detener inmediatamente al llegar a la fila de Totales o sección de Ajustes/Resumen inferior
        if (
          col17Str.includes('TOTAL') ||
          col0Str.includes('AJUSTES') ||
          col13Str.includes('RESUMEN LIBRO') ||
          col13Str.includes('TOTAL')
        ) {
          break;
        }

        const nroOp = row[0];
        if (typeof nroOp !== 'number') continue;

        const fecRaw = row[1];
        const rifRaw = row[3];
        const razonRaw = row[4];
        const nroFac = row[12];
        const nroCtrl = row[13];
        const base = Number(row[20]);
        const iva = Number(row[22]);
        const ret = Number(row[23]) || 0.0;

        if (base && !isNaN(base) && base > 0) {
          const rif = rifRaw ? String(rifRaw).trim().toUpperCase() : 'S/RIF';
          const razon = razonRaw ? String(razonRaw).trim() : `Proveedor Operación #${nroOp} (${periodo})`;
          const fac = nroFac ? String(nroFac).trim() : `OP-${nroOp}`;
          const ctrl = nroCtrl ? String(nroCtrl).trim() : null;
          const fecha = parsePurchaseDate(fecRaw, periodo);
          const ivaCalculado = (iva && !isNaN(iva) && iva > 0) ? Number(iva.toFixed(2)) : Number((base * 0.16).toFixed(2));
          const baseRedondeada = Number(base.toFixed(2));
          const totalBs = Number((baseRedondeada + ivaCalculado).toFixed(2));

          const { tipo, aplica } = classifyProvider(rif, razon);
          let provId = provMap.get(rif);

          if (!provId && rif !== 'S/RIF') {
            for (const client of [localDb, tursoDb].filter(Boolean)) {
              const res = await client.execute({
                sql: `INSERT INTO proveedores (rif, razon_social, tipo_servicio, aplica_inventario, porcentaje_retencion) 
                      VALUES (?, ?, ?, ?, 75.0) 
                      ON CONFLICT(rif) DO UPDATE SET razon_social = excluded.razon_social RETURNING id`,
                args: [rif, razon, tipo, aplica]
              });
              if (res.rows?.[0]?.id) provId = res.rows[0].id;
            }
            if (provId) provMap.set(rif, provId);
          }

          const estatus = aplica === 0 ? 'NO_APLICA_GASTO' : 'NO_CONCILIADO';
          const obs = aplica === 0 ? `Gasto / Servicio (${tipo})` : 'Factura declarada en Libro de Compras SENIAT';

          comprasPeriodo.push({
            periodo,
            archivo_origen: fname,
            nro_operacion: nroOp,
            fecha,
            rif,
            razon_social: razon,
            nro_factura: fac,
            nro_control: ctrl,
            base_imponible_bs: baseRedondeada,
            alicuota: 0.16,
            iva_bs: ivaCalculado,
            total_bs: totalBs,
            iva_retenido_bs: Number(ret.toFixed(2)),
            proveedor_id: provId || null,
            tipo_servicio: tipo,
            aplica_inventario: aplica,
            estatus_conciliacion: estatus,
            observaciones_cruce: obs
          });

          totComprasBase += base;
          totComprasIva += iva;
        }
      }
    }

    for (const c of comprasPeriodo) {
      for (const client of [localDb, tursoDb].filter(Boolean)) {
        await client.execute({
          sql: `INSERT INTO libro_compras 
                (periodo, archivo_origen, nro_operacion, fecha, rif, razon_social, nro_factura, nro_control,
                 base_imponible_bs, alicuota, iva_bs, total_bs, iva_retenido_bs, proveedor_id,
                 tipo_servicio, aplica_inventario, estatus_conciliacion, observaciones_cruce)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            c.periodo, c.archivo_origen, c.nro_operacion, c.fecha, c.rif, c.razon_social, c.nro_factura, c.nro_control,
            c.base_imponible_bs, c.alicuota, c.iva_bs, c.total_bs, c.iva_retenido_bs, c.proveedor_id,
            c.tipo_servicio, c.aplica_inventario, c.estatus_conciliacion, c.observaciones_cruce
          ]
        });
      }
    }

    // 2. LIBRO DE VENTAS (solo filas diarias reales de ZOA0000176 antes de "Total ZOA0000176")
    const vSheetName = wb.SheetNames.find(s => s.toUpperCase().includes('VENTAS'));
    let ventasPeriodo = [];
    let totVentasBase = 0;
    let totVentasIva = 0;
    let totComprobantes = 0;

    if (vSheetName) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[vSheetName], { header: 1 });
      for (let r = 13; r < data.length; r++) {
        const row = data[r] || [];
        const col0Str = String(row[0] || '').trim().toUpperCase();
        if (col0Str.includes('TOTAL')) {
          break; // Detener en "Total ZOA0000176"
        }

        const fecRaw = row[1];
        if (!fecRaw) continue;

        const tot = Number(row[3]) || 0.0;
        const col5Raw = row[5];
        const ex = (typeof col5Raw === 'number' && !isNaN(col5Raw)) ? col5Raw : 0.0;
        const notaEspecial = (typeof col5Raw === 'string' && col5Raw.trim().length > 0) ? col5Raw.trim() : null;
        const base = Number(row[7]) || 0.0;
        const iva = Number(row[9]) || 0.0;
        const desde = row[16] ? String(row[16]).trim() : null;
        const hasta = row[17] ? String(row[17]).trim() : null;
        const cant = Number(row[18]) || 0;

        // Importamos filas con ventas gravadas (> 0) o con nota especial (ANULADA / MAQUINA AVERIADA con comprobantes)
        if (base > 0 || (notaEspecial && (desde || hasta))) {
          const fecha = parseSalesDate(fecRaw, periodo, r - 13) || `${periodo}-01`;
          const baseRedondeada = Number(base.toFixed(2));
          const ivaRedondeado = Number((iva > 0 ? iva : base * 0.16).toFixed(2));
          const totalRedondeado = Number((tot > 0 ? tot : baseRedondeada + ivaRedondeado + ex).toFixed(2));

          ventasPeriodo.push({
            periodo,
            archivo_origen: fname,
            fecha,
            factura_desde: notaEspecial && base === 0 ? `${desde || ''} (${notaEspecial})`.trim() : desde,
            factura_hasta: hasta,
            total_bs: totalRedondeado,
            exento_bs: Number(ex.toFixed(2)),
            base_imponible_bs: baseRedondeada,
            alicuota: 0.16,
            iva_bs: ivaRedondeado,
            cantidad_comprobantes: cant,
            estatus_conciliacion: notaEspecial && base === 0 ? notaEspecial : 'REGISTRADO_FISCAL'
          });

          totVentasBase += base;
          totVentasIva += iva;
          totComprobantes += cant;
        }
      }
    }

    for (const v of ventasPeriodo) {
      for (const client of [localDb, tursoDb].filter(Boolean)) {
        await client.execute({
          sql: `INSERT INTO libro_ventas 
                (periodo, archivo_origen, fecha, factura_desde, factura_hasta, total_bs, exento_bs,
                 base_imponible_bs, alicuota, iva_bs, cantidad_comprobantes, estatus_conciliacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            v.periodo, v.archivo_origen, v.fecha, v.factura_desde, v.factura_hasta, v.total_bs, v.exento_bs,
            v.base_imponible_bs, v.alicuota, v.iva_bs, v.cantidad_comprobantes, v.estatus_conciliacion
          ]
        });
      }
    }

    // 3. RESUMEN DE DECLARACIÓN FORMA 30 (Fiel al 100% a la hoja 'RESUMEN IVA' del archivo Excel)
    const declVentasBase = resumenOficial ? resumenOficial.ventasBase : Number(totVentasBase.toFixed(2));
    const declDebito = resumenOficial ? resumenOficial.debitoFiscal : Number(totVentasIva.toFixed(2));
    const declComprasBase = resumenOficial ? resumenOficial.comprasBase : Number(totComprasBase.toFixed(2));
    const declCredito = resumenOficial ? resumenOficial.creditoFiscal : Number(totComprasIva.toFixed(2));
    const declExcAnt = resumenOficial ? resumenOficial.excedenteAnterior : ultimoExcedenteSiguiente;
    const declRet = resumenOficial ? resumenOficial.retencionesPeriodo : 0.0;
    const declExcSig = resumenOficial ? resumenOficial.excedenteSiguiente : 0.0;
    const declAPagar = resumenOficial ? resumenOficial.totalAPagar : 0.0;

    ultimoExcedenteSiguiente = declExcSig;

    for (const client of [localDb, tursoDb].filter(Boolean)) {
      await client.execute({
        sql: `INSERT INTO declaraciones_iva 
              (periodo, archivo_origen, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
               iva_retenido_bs, total_compras_facturas, total_ventas_dias, estatus,
               excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DECLARADO', ?, ?, ?)`,
        args: [
          periodo, fname, declVentasBase, declDebito, declComprasBase, declCredito,
          declRet, comprasPeriodo.length, ventasPeriodo.length,
          declExcAnt, declExcSig, declAPagar
        ]
      });
    }

    console.log(`  ✓ Libro Compras: ${comprasPeriodo.length} facturas | Base: Bs. ${declComprasBase.toLocaleString('es-VE', {minimumFractionDigits: 2})} | Crédito: Bs. ${declCredito.toLocaleString('es-VE', {minimumFractionDigits: 2})}`);
    console.log(`  ✓ Libro Ventas : ${ventasPeriodo.length} registros | Base: Bs. ${declVentasBase.toLocaleString('es-VE', {minimumFractionDigits: 2})} | Débito : Bs. ${declDebito.toLocaleString('es-VE', {minimumFractionDigits: 2})}`);
    console.log(`  ⚖ Forma 30 (${periodo}): Exc.Ant=${declExcAnt.toFixed(2)} | Ret.Clientes=${declRet.toFixed(2)} | Exc.Sig=${declExcSig.toFixed(2)} | Total a Pagar=${declAPagar.toFixed(2)}`);
  }

  // 4. PREPARAR MES DE OCTUBRE 2026 (2026-10) PARA CARGA MANUAL EN EL SISTEMA
  // Arrastre exacto del Excedente de Crédito Fiscal de Septiembre 2026: Bs. 45.355,86
  console.log('\n--- PREPARANDO OCTUBRE 2026 (2026-10) CON ARRASTRE OFICIAL DE SEPTIEMBRE ---');
  const octPeriodo = '2026-10';
  const octExcedenteAnterior = ultimoExcedenteSiguiente; // 45355.86 Bs.

  for (const client of [localDb, tursoDb].filter(Boolean)) {
    await client.execute({
      sql: `INSERT INTO declaraciones_iva 
            (periodo, archivo_origen, ventas_base_bs, debito_fiscal_bs, compras_base_bs, credito_fiscal_bs,
             iva_retenido_bs, total_compras_facturas, total_ventas_dias, estatus,
             excedente_anterior_bs, excedente_siguiente_bs, total_a_pagar_bs)
            VALUES (?, 'CARGA_MANUAL_SISTEMA', 0.0, 0.0, 0.0, 0.0, 0.0, 0, 0, 'EN_PROCESO', ?, ?, 0.0)`,
      args: [octPeriodo, octExcedenteAnterior, octExcedenteAnterior]
    });
  }

  console.log(`✓ Octubre 2026 (2026-10) inicializado limpio para carga manual con Excedente de Crédito Fiscal del Mes Anterior = Bs. ${octExcedenteAnterior.toLocaleString('es-VE', {minimumFractionDigits: 2})}`);
  console.log('=== AUDITORÍA Y SINCRONIZACIÓN COMPLETADA AL 100% ===');
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error('Error en migración fiscal:', err);
  process.exit(1);
});
