/**
 * scripts/test_registrar_factura_2601.js
 * Registra la factura 00002601 del ticket del usuario
 */

import { createClient } from '@libsql/client';
import { conciliarVentaIndividual, getResumenCruceDobleVia } from '../lib/cruce_engine.js';
import dotenv from 'dotenv';
dotenv.config();

const isTurso = process.env.TARGET === 'turso';
const client = isTurso
  ? createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    })
  : createClient({ url: 'file:inventario_dg67.db' });

async function run() {
  console.log('--- Registrando Factura 00002601 (Ticket Subido por el Usuario) ---');

  // Buscar producto 506
  const prodRes = await client.execute("SELECT id, codigo, descripcion FROM productos WHERE codigo = '506'");
  if (prodRes.rows.length === 0) {
    console.error('Producto 506 no encontrado');
    return;
  }
  const prod = prodRes.rows[0];
  console.log(`Producto encontrado: ID ${prod.id} - ${prod.codigo}: ${prod.descripcion}`);

  // Verificar si ya existe movimiento para FACT 2601
  const movCheck = await client.execute("SELECT id FROM movimientos WHERE fecha = '2026-10-29' AND numero_factura_numerico = 2601");
  let movId;
  if (movCheck.rows.length === 0) {
    const movIns = await client.execute({
      sql: `INSERT INTO movimientos 
            (tipo, fecha, numero_documento, numero_factura_numerico, subtipo, nro_control, usuario_responsable,
             tasa_bcv, fecha_tasa_bcv, moneda_operacion, observaciones, estatus_conciliacion)
            VALUES 
            ('SALIDA_VENTA', '2026-10-29', '00002601', 2601, 'VENTA', 'ZOA0000176', 'CAJA_DG67',
             889.58, '2026-10-29', 'BS', 'Factura fiscal emitida ticket ZOA0000176 (Limpia parabrisas)', 'PENDIENTE_UCG')
            RETURNING id`
    });
    movId = movIns.rows[0].id;

    // Insertar detalle
    const baseBs = 3831.42;
    const ivaBs = 613.03;
    const totalBs = 4444.45;
    const tasa = 889.58;
    const totalUsd = Number((totalBs / tasa).toFixed(2));
    const baseUsd = Number((baseBs / tasa).toFixed(2));
    const ivaUsd = Number((ivaBs / tasa).toFixed(2));

    await client.execute({
      sql: `INSERT INTO movimiento_detalles 
            (movimiento_id, producto_id, cantidad, costo_unitario_usd, costo_unitario_ves,
             precio_unitario_bs, precio_unitario_divisa, base_imponible_bs, base_imponible_divisa,
             monto_iva_bs, monto_iva_divisa, total_linea_bs, total_linea_divisa)
            VALUES 
            (?, ?, 1, 0, 0,
             ?, ?, ?, ?,
             ?, ?, ?, ?)`,
      args: [movId, prod.id, baseBs, baseUsd, baseBs, baseUsd, ivaBs, ivaUsd, totalBs, totalUsd]
    });
    console.log(`Movimiento insertado con ID: ${movId}`);
  } else {
    movId = movCheck.rows[0].id;
    console.log(`Movimiento ya existía con ID: ${movId}`);
  }

  // Conciliar individualmente
  console.log('Ejecutando conciliación al vuelo...');
  const resConcil = await conciliarVentaIndividual(movId, client);
  console.log('Resultado:', resConcil);

  // Obtener estado general
  const resumen = await getResumenCruceDobleVia('2026-10', client);
  console.log('\n--- Estado luego de registrar 00002601 ---');
  console.log('Facturas esperadas:', resumen.ventas.kpis.total_facturas_esperadas);
  console.log('Facturas cargadas:', resumen.ventas.kpis.total_facturas_cargadas);
  console.log('Facturas pendientes:', resumen.ventas.kpis.total_facturas_faltantes);
  console.log('Lista faltantes:', resumen.ventas.facturas_pendientes_dg67.map(f => f.factura_numero));
}

run().catch(console.error);
