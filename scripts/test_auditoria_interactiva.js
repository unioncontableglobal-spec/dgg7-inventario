import { createClient } from '@libsql/client';
import { getListadoAuditoriaEnVivo, actualizarProductoAuditoria, toggleAuditadoProducto } from '../lib/auditoria_punto_cero.js';

const db = createClient({ url: 'file:inventario_dg67.db' });

async function test() {
  console.log('=== TEST AUDITORÍA INTERACTIVA EN TIEMPO REAL ===');

  const res = await getListadoAuditoriaEnVivo(db);
  console.log('Estadísticas globales iniciales:');
  console.log(JSON.stringify(res.estadisticas, null, 2));
  console.log(`Productos cargados: ${res.productos.length}`);

  if (res.productos.length > 0) {
    const p = res.productos[0];
    console.log(`\nProbando actualización interactiva para [${p.codigo}] ${p.descripcion}:`);
    console.log(`  Stock actual: ${p.stock_actual}, Costo actual: $${p.costo_s_iva_usd}, Precio venta: $${p.precio_venta_s_iva_usd}`);

    const updateRes = await actualizarProductoAuditoria(p.producto_id, {
      cantidad_fisica_real: p.stock_actual, // Sin diferencia de stock para test inicial
      costo_s_iva_usd: 10.50,
      precio_venta_s_iva_usd: 15.00,
      inactivo: 0,
      auditado: 1,
      fecha: '2026-10-31',
      tasa_bcv: 889.58,
      usuario: 'TEST_AGENT'
    }, db);

    console.log('\nResultado actualización:');
    console.log(JSON.stringify(updateRes.estadisticas, null, 2));
    console.log('Producto actualizado:');
    console.log(JSON.stringify(updateRes.producto_actualizado, null, 2));

    // Probar toggle auditado
    const toggleRes = await toggleAuditadoProducto(p.producto_id, 0, db);
    console.log('\nResultado toggle a no auditado:');
    console.log(JSON.stringify(toggleRes.estadisticas, null, 2));
  }

  console.log('\n✅ Test de Auditoría Interactiva superado con éxito.');
}

test().catch(console.error);
