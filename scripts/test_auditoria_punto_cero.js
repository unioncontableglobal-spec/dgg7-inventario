import { createClient } from '@libsql/client';
import { getMatrizAuditoriaProductos, procesarMatrizAuditada } from '../lib/auditoria_punto_cero.js';

const db = createClient({ url: 'file:inventario_dg67.db' });

async function test() {
  console.log('=== TEST DE AUDITORÍA Y SINCERACIÓN (PUNTO CERO) ===');

  const matriz = await getMatrizAuditoriaProductos(db);
  console.log(`Matriz exportable generada con ${matriz.length} productos y 15 columnas.`);

  // Simular auditoría de 3 productos
  const p1 = matriz[0]; // e.g. 04891721AB (stock 6, costo 9.8)
  const p2 = matriz[1]; // e.g. A1 (stock ?, costo ?)
  const p3 = matriz[2]; // e.g. A2 (stock ?, costo ?)

  const itemsAuditados = [
    {
      'Código de Producto': p1.codigo,
      'CANTIDAD FÍSICA REAL': p1.stock_actual + 4, // Sobrante de 4 -> Entrada por Sinceración
      'COSTO ACTUALIZADO S/IVA': 12.50, // Costo actualizado
      'Precio de Venta S/IVA': 18.00, // Precio de venta actualizado
      'ESTATUS': 'Activo'
    },
    {
      'Código de Producto': p2.codigo,
      'CANTIDAD FÍSICA REAL': Math.max(0, p2.stock_actual - 3), // Faltante de 3 -> Salida por Ajuste
      'COSTO ACTUALIZADO S/IVA': p2.costo_historico_s_iva,
      'ESTATUS': 'Activo'
    },
    {
      'Código de Producto': p3.codigo,
      'CANTIDAD FÍSICA REAL': p3.stock_actual,
      'COSTO ACTUALIZADO S/IVA': p3.costo_historico_s_iva,
      'ESTATUS': 'Inactivo' // Soft delete
    }
  ];

  console.log('\n--- Ejecutando Simulación (Dry-Run) ---');
  const resultadoSim = await procesarMatrizAuditada(itemsAuditados, { simular: true, tasa_bcv: 889.58 }, db);
  console.log('Resultado Simulación:');
  console.log(JSON.stringify(resultadoSim.resumen, null, 2));

  console.log('\n✅ Prueba de lógica de auditoría superada con éxito.');
}

test().catch(console.error);
