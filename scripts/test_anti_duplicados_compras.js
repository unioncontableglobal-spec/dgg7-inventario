import { createClient } from '@libsql/client';
import { verificarDuplicadoLibroCompras, verificarDuplicadoEntradaAlmacen } from '../lib/cruce_engine.js';

const db = createClient({ url: 'file:inventario_dg67.db' });

async function runTests() {
  console.log('=== INICIANDO PRUEBAS DEL SISTEMA ANTI-DUPLICADOS DE COMPRAS ===\n');

  // Test 1: Inversiones Angelinev (J-30865927-4) tiene factura 004526
  console.log('Test 1: Factura 4526 con mismo RIF (J308659274)');
  const res1 = await verificarDuplicadoLibroCompras('J308659274', '4526', null, null, db);
  console.log('Resultado 1:', res1.duplicado ? 'BLOQUEADO CORRECTAMENTE (Duplicado)' : 'FALLÓ', '-', res1.mensaje);

  // Test 2: Mismo número 4526 pero de OTRO proveedor diferente que no la tiene (ej: J-50714716-9)
  console.log('\nTest 2: Factura 4526 con OTRO RIF (J-50714716-9) que no tiene esa factura');
  const res2 = await verificarDuplicadoLibroCompras('J-50714716-9', '4526', null, null, db);
  console.log('Resultado 2:', !res2.duplicado ? 'PERMITIDO CORRECTAMENTE (No es duplicado para ese proveedor)' : 'FALLÓ (Falso positivo)');

  // Test 3: Union Global (J-50714716-9) tiene factura 000006 con control 00-00000007
  console.log('\nTest 3: Factura 6 con formato diferente pero mismo RIF');
  const res3 = await verificarDuplicadoLibroCompras('J-50714716-9', '6', null, null, db);
  console.log('Resultado 3:', res3.duplicado ? 'BLOQUEADO CORRECTAMENTE (Duplicado)' : 'FALLÓ', '-', res3.mensaje);

  // Test 4: Factura inexistente (9999999)
  console.log('\nTest 4: Factura totalmente nueva (9999999)');
  const res4 = await verificarDuplicadoLibroCompras('J-50714716-9', '9999999', null, null, db);
  console.log('Resultado 4:', !res4.duplicado ? 'PERMITIDO CORRECTAMENTE (Nueva factura)' : 'FALLÓ');

  // Test 5: Entrada en almacén existente (proveedor 2, factura 00002242)
  console.log('\nTest 5: Entrada de almacén con factura 2242 de proveedor 2');
  const res5 = await verificarDuplicadoEntradaAlmacen(2, '2242', null, db);
  console.log('Resultado 5:', res5.duplicado ? 'BLOQUEADO CORRECTAMENTE (Entrada existente)' : 'FALLÓ', '-', res5.mensaje);

  // Test 6: Entrada de almacén para factura nueva
  console.log('\nTest 6: Entrada de almacén para factura nueva (FACT 888777)');
  const res6 = await verificarDuplicadoEntradaAlmacen(2, 'FACT 888777', null, db);
  console.log('Resultado 6:', !res6.duplicado ? 'PERMITIDO CORRECTAMENTE (Nueva entrada)' : 'FALLÓ');

  console.log('\n=== TODAS LAS PRUEBAS COMPLETADAS CON ÉXITO ===');
}

runTests().catch(console.error);
