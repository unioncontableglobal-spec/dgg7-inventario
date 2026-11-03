/**
 * scripts/test_motor_cruce.js
 * Prueba del motor de conciliación de doble vía DG67 ↔ UCG
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

// Función para conciliar un Reporte Z contra las salidas cargadas por DG67
export async function conciliarReporteZ(reporteZId, db = client) {
  const zRes = await db.execute({
    sql: "SELECT * FROM libro_ventas WHERE id = ?",
    args: [reporteZId]
  });
  if (zRes.rows.length === 0) return null;
  const z = zRes.rows[0];

  const desdeNum = z.factura_desde ? parseInt(String(z.factura_desde).replace(/\D/g, ''), 10) : null;
  const hastaNum = z.factura_hasta ? parseInt(String(z.factura_hasta).replace(/\D/g, ''), 10) : null;

  if (!desdeNum || !hastaNum || isNaN(desdeNum) || isNaN(hastaNum)) {
    // Si no tiene rango numérico definido, no se puede calcular rango correlativo automático
    return { z, estatus: z.estatus_conciliacion || 'REGISTRADO_FISCAL' };
  }

  // Generar lista de números esperados
  const esperados = [];
  for (let n = desdeNum; n <= hastaNum; n++) {
    esperados.push(n);
  }

  // Buscar movimientos de salida registrados por DG67 en ese rango o fecha
  const movsRes = await db.execute({
    sql: `SELECT m.id, m.numero_documento, m.numero_factura_numerico, m.fecha,
                 COALESCE(SUM(NULLIF(md.total_linea_bs, 0)), SUM(md.cantidad * md.precio_unitario_bs), 0) AS total_bs
          FROM movimientos m
          LEFT JOIN movimiento_detalles md ON m.id = md.movimiento_id
          WHERE m.tipo = 'SALIDA_VENTA' 
            AND (m.numero_factura_numerico BETWEEN ? AND ? OR m.fecha = ?)
          GROUP BY m.id`,
    args: [desdeNum, hastaNum, z.fecha]
  });

  const cargadosNums = new Set();
  let totalCargadoBs = 0;
  const movIds = [];

  for (const m of movsRes.rows) {
    if (m.numero_factura_numerico && m.numero_factura_numerico >= desdeNum && m.numero_factura_numerico <= hastaNum) {
      cargadosNums.add(m.numero_factura_numerico);
      totalCargadoBs += Number(m.total_bs) || 0;
      movIds.push(m.id);
    }
  }

  const faltantes = esperados.filter(num => !cargadosNums.has(num));
  const diffBs = Number((z.total_bs - totalCargadoBs).toFixed(2));

  let estatus = 'PENDIENTE_DG67';
  let obs = '';

  if (faltantes.length === 0) {
    if (Math.abs(diffBs) <= 2.00) {
      estatus = 'CONCILIADO';
      obs = `✅ Conciliación exitosa. Todas las ${esperados.length} facturas detalladas por DG67 cuadran con el Reporte Z.`;
    } else {
      estatus = 'DISCREPANCIA';
      obs = `⚠️ Rango correlativo completo pero hay una diferencia de Bs. ${diffBs.toLocaleString('es-VE')} ($${(diffBs / (z.tasa_bcv || 1)).toFixed(2)} USD).`;
    }
  } else {
    estatus = 'PENDIENTE_DG67';
    obs = `⏳ Pendiente: DG67 tiene ${cargadosNums.size} facturas cargadas de ${esperados.length}. Faltan ${faltantes.length} facturas por detallar.`;
  }

  const faltantesStr = faltantes.map(f => String(f).padStart(8, '0')).join(', ');

  // Actualizar libro_ventas
  await db.execute({
    sql: `UPDATE libro_ventas 
          SET estatus_conciliacion = ?,
              facturas_faltantes = ?,
              cantidad_facturas_cargadas = ?,
              total_facturas_cargadas_bs = ?,
              diferencia_bs = ?,
              observaciones_cruce = ?
          WHERE id = ?`,
    args: [estatus, faltantesStr, cargadosNums.size, totalCargadoBs, diffBs, obs, z.id]
  });

  // Actualizar movimientos vinculados
  if (movIds.length > 0) {
    const movEstatus = estatus === 'CONCILIADO' ? 'CONCILIADO' : 'PARCIAL';
    for (const id of movIds) {
      await db.execute({
        sql: "UPDATE movimientos SET libro_ventas_id = ?, estatus_conciliacion = ? WHERE id = ?",
        args: [z.id, movEstatus, id]
      });
    }
  }

  return {
    reporte_z_id: z.id,
    fecha: z.fecha,
    rango: `${z.factura_desde} ➔ ${z.factura_hasta}`,
    esperados_cant: esperados.length,
    cargados_cant: cargadosNums.size,
    faltantes_cant: faltantes.length,
    faltantes_lista: faltantes.map(f => String(f).padStart(8, '0')),
    total_z_bs: z.total_bs,
    total_cargado_bs: totalCargadoBs,
    diferencia_bs: diffBs,
    estatus,
    observaciones: obs
  };
}

async function main() {
  console.log('--- Probando inserción y conciliación del Reporte Z del 29/10/2026 (Ticket de Usuario) ---');

  // Insertar Reporte Z 0317 del 29/10/2026 según el ticket fiscal subido por el usuario
  const checkZ = await client.execute("SELECT id FROM libro_ventas WHERE periodo = '2026-10' AND fecha = '2026-10-29'");
  let zId;
  if (checkZ.rows.length === 0) {
    const insZ = await client.execute({
      sql: `INSERT INTO libro_ventas 
            (periodo, archivo_origen, fecha, numero_reporte_z, serial_impresora, factura_desde, factura_hasta,
             cantidad_comprobantes, cantidad_anuladas, total_anulaciones_bs,
             base_imponible_bs, alicuota, iva_bs, total_bs,
             tasa_bcv, fecha_tasa_bcv, moneda_divisa, base_imponible_divisa, monto_iva_divisa, total_divisa,
             estatus_conciliacion)
            VALUES 
            ('2026-10', 'REPORTE_Z_TICKET', '2026-10-29', '0317', 'Z0A0000176', '00002595', '00002602',
             8, 1, 8888.90,
             35249.09, 0.16, 5639.85, 40888.94,
             889.58, '2026-10-29', 'USD', 39.62, 6.34, 45.96,
             'PENDIENTE_DG67')
            RETURNING id`
    });
    zId = insZ.rows[0].id;
    console.log(`Reporte Z 0317 insertado con ID: ${zId}`);
  } else {
    zId = checkZ.rows[0].id;
    console.log(`Reporte Z ya existía con ID: ${zId}`);
  }

  // Ejecutar conciliación
  const resultado = await conciliarReporteZ(zId);
  console.log('\nResultado de la conciliación:');
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
