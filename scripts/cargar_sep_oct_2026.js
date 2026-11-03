import XLSX from 'xlsx';
import { createClient } from '@libsql/client';

const client = createClient({ url: 'file:inventario_dg67.db' });

function excelDateToJS(val) {
  if (typeof val === 'number') {
    const utc_days = Math.floor(val - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    return date_info.toISOString().split('T')[0];
  }
  return String(val || '').trim();
}

async function run() {
  console.log('--- Iniciando Carga de Inventario: Septiembre y Octubre 2026 ---');

  const wb = XLSX.readFile('1. SISTEMA DE INVENTARIO - DG67CA sep y oct 26.xlsx');
  const ws = wb.Sheets['2. REGISTRO ENTRADAS - SALIDAS'];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // 1. Obtener catálogo actual de productos
  const prodRes = await client.execute('SELECT id, codigo, descripcion, categoria_id, almacen_id, costo_referencial_usd FROM productos');
  const prodMap = new Map();
  prodRes.rows.forEach(p => {
    prodMap.set(String(p.codigo).trim().toUpperCase(), p);
  });

  // 2. Registrar productos faltantes si no existen
  const missingProds = [
    { codigo: '698', descripcion: 'LUCES LED FENIZ', categoria_id: 11, almacen_id: 1, costo: 12.0, stock_min: 5 },
    { codigo: '599', descripcion: 'FLASHER 2 PT', categoria_id: 4, almacen_id: 1, costo: 4.5, stock_min: 5 }
  ];

  for (const mp of missingProds) {
    if (!prodMap.has(mp.codigo)) {
      const ins = await client.execute({
        sql: `INSERT INTO productos (codigo, descripcion, categoria_id, almacen_id, unidad_medida, stock_minimo, costo_referencial_usd, activo)
              VALUES (?, ?, ?, ?, 'UND', ?, ?, 1) RETURNING id`,
        args: [mp.codigo, mp.descripcion, mp.categoria_id, mp.almacen_id, mp.stock_min, mp.costo]
      });
      const newId = ins.rows[0].id;
      prodMap.set(mp.codigo, { id: newId, codigo: mp.codigo, descripcion: mp.descripcion, costo_referencial_usd: mp.costo });
      console.log(`+ Creado producto nuevo en catálogo: ${mp.codigo} - ${mp.descripcion} (ID: ${newId})`);
    }
  }

  // 3. Obtener proveedores
  const provRes = await client.execute('SELECT id, rif, razon_social FROM proveedores');
  const provMap = new Map();
  provRes.rows.forEach(pr => {
    provMap.set(String(pr.razon_social).trim().toLowerCase(), pr.id);
  });

  function getProvId(provName) {
    if (!provName) return null;
    const clean = String(provName).trim().toLowerCase();
    for (const [name, id] of provMap.entries()) {
      if (name.includes(clean) || clean.includes(name)) return id;
    }
    return null;
  }

  // 4. Filtrar y procesar líneas de Septiembre y Octubre
  const sepEntradas = [];
  const sepSalidas = [];
  const octSalidas = [];

  for (let r = 381; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    const rawDate = row[4];
    const fecha = excelDateToJS(rawDate);
    const codigo = String(row[5] || '').trim();
    if (!codigo) continue; // ignora filas vacías

    const desc = String(row[6] || '').trim();
    const prov = String(row[7] || '').trim();
    const costo = Number(row[9] || 0);
    const fact = String(row[10] || '').trim();
    const cantEntrada = Number(row[11] || 0);
    const cantSalida = Number(row[12] || 0);
    const obs = String(row[13] || '').trim();

    const prod = prodMap.get(codigo.toUpperCase());
    if (!prod) {
      console.warn(`! Advertencia: Código no encontrado en fila ${r}: ${codigo}`);
      continue;
    }

    const item = {
      rowIdx: r,
      fecha,
      codigo,
      desc,
      prov,
      costo,
      fact,
      cantEntrada,
      cantSalida,
      obs,
      prod
    };

    if (fecha.startsWith('2026-09')) {
      if (cantEntrada > 0) sepEntradas.push(item);
      if (cantSalida > 0) sepSalidas.push(item);
    } else if (fecha.startsWith('2026-10')) {
      if (cantSalida > 0) octSalidas.push(item);
    }
  }

  console.log(`Líneas identificadas para carga:`);
  console.log(`- Septiembre 2026 Entradas (Compras): ${sepEntradas.length}`);
  console.log(`- Septiembre 2026 Salidas (Ventas): ${sepSalidas.length}`);
  console.log(`- Octubre 2026 Salidas (Ventas): ${octSalidas.length}`);

  // Tasas oficiales de cierre de período
  const TASA_SEP = 859.0629;
  const TASA_OCT = 889.5800;

  // 5. Cargar Septiembre Entradas (Compras)
  // Agrupar por documento u observación
  let movsEntSep = 0;
  let itemsEntSep = 0;

  // Agrupar por fecha + obs (número de documento) + proveedor
  const entradasGrouped = new Map();
  for (const item of sepEntradas) {
    const doc = item.obs || item.fact || 'COMPRA_S_N';
    const key = `${item.fecha}_${item.prov}_${doc}`;
    if (!entradasGrouped.has(key)) {
      entradasGrouped.set(key, {
        fecha: item.fecha,
        prov: item.prov,
        doc,
        items: []
      });
    }
    entradasGrouped.get(key).items.push(item);
  }

  for (const [key, grp] of entradasGrouped.entries()) {
    const provId = getProvId(grp.prov) || 24; // default Isopartes si no calza
    const docNum = grp.doc;

    const insMov = await client.execute({
      sql: `INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones, usuario_responsable, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion)
            VALUES ('ENTRADA_COMPRA', ?, ?, ?, ?, 'admin', ?, '2026-09-30', 'USD', 'PROMEDIO_PONDERADO') RETURNING id`,
      args: [grp.fecha, docNum, provId, `Recepción Almacén Sep 2026: ${docNum} (${grp.prov || 'DG67'})`, TASA_SEP]
    });
    const movId = insMov.rows[0].id;
    movsEntSep++;

    for (const line of grp.items) {
      const cUsd = line.costo > 0 ? line.costo : (Number(line.prod.costo_referencial_usd) || 2.5);
      const cBs = Number((cUsd * TASA_SEP).toFixed(2));
      const totUsd = Number((line.cantEntrada * cUsd).toFixed(2));
      const totBs = Number((line.cantEntrada * cBs).toFixed(2));

      await client.execute({
        sql: `INSERT INTO movimiento_detalles (
                movimiento_id, producto_id, cantidad, 
                costo_unitario_usd, costo_unitario_bs, costo_unitario_ves, costo_unitario_divisa,
                tasa_bcv_operacion, base_imponible_bs, base_imponible_divisa, total_linea_bs, total_linea_divisa
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          movId, line.prod.id, line.cantEntrada,
          cUsd, cBs, cBs, cUsd,
          TASA_SEP, totBs, totUsd, totBs, totUsd
        ]
      });
      itemsEntSep++;
    }
  }

  // 6. Cargar Septiembre Salidas (Ventas)
  let movsSalSep = 0;
  let itemsSalSep = 0;

  const salidasSepGrouped = new Map();
  for (const item of sepSalidas) {
    const doc = item.obs || item.fact || 'VENTA_S_N';
    const key = `${item.fecha}_${doc}`;
    if (!salidasSepGrouped.has(key)) {
      salidasSepGrouped.set(key, { fecha: item.fecha, doc, items: [] });
    }
    salidasSepGrouped.get(key).items.push(item);
  }

  for (const [key, grp] of salidasSepGrouped.entries()) {
    const insMov = await client.execute({
      sql: `INSERT INTO movimientos (tipo, fecha, numero_documento, observaciones, usuario_responsable, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion)
            VALUES ('SALIDA_VENTA', ?, ?, ?, 'admin', ?, '2026-09-30', 'USD', 'PROMEDIO_PONDERADO') RETURNING id`,
      args: [grp.fecha, grp.doc, `Venta Facturada Sep 2026: ${grp.doc}`, TASA_SEP]
    });
    const movId = insMov.rows[0].id;
    movsSalSep++;

    for (const line of grp.items) {
      const cUsd = Number(line.prod.costo_referencial_usd) || 2.5;
      const cBs = Number((cUsd * TASA_SEP).toFixed(2));
      const pUsd = Number((cUsd * 1.35).toFixed(2)); // margen venta estimado
      const pBs = Number((pUsd * TASA_SEP).toFixed(2));
      const totUsd = Number((line.cantSalida * pUsd).toFixed(2));
      const totBs = Number((line.cantSalida * pBs).toFixed(2));

      await client.execute({
        sql: `INSERT INTO movimiento_detalles (
                movimiento_id, producto_id, cantidad,
                costo_unitario_usd, costo_unitario_bs,
                precio_unitario_divisa, precio_unitario_bs,
                tasa_bcv_operacion, base_imponible_bs, base_imponible_divisa,
                total_linea_bs, total_linea_divisa
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          movId, line.prod.id, line.cantSalida,
          cUsd, cBs,
          pUsd, pBs,
          TASA_SEP, totBs, totUsd,
          totBs, totUsd
        ]
      });
      itemsSalSep++;
    }
  }

  // 7. Cargar Octubre Salidas (Ventas)
  let movsSalOct = 0;
  let itemsSalOct = 0;

  const salidasOctGrouped = new Map();
  for (const item of octSalidas) {
    const doc = item.obs || item.fact || 'VENTA_S_N';
    const key = `${item.fecha}_${doc}`;
    if (!salidasOctGrouped.has(key)) {
      salidasOctGrouped.set(key, { fecha: item.fecha, doc, items: [] });
    }
    salidasOctGrouped.get(key).items.push(item);
  }

  for (const [key, grp] of salidasOctGrouped.entries()) {
    const insMov = await client.execute({
      sql: `INSERT INTO movimientos (tipo, fecha, numero_documento, observaciones, usuario_responsable, tasa_bcv, fecha_tasa_bcv, moneda_operacion, metodo_valoracion)
            VALUES ('SALIDA_VENTA', ?, ?, ?, 'admin', ?, '2026-10-31', 'USD', 'PROMEDIO_PONDERADO') RETURNING id`,
      args: [grp.fecha, grp.doc, `Venta Facturada Oct 2026: ${grp.doc}`, TASA_OCT]
    });
    const movId = insMov.rows[0].id;
    movsSalOct++;

    for (const line of grp.items) {
      const cUsd = Number(line.prod.costo_referencial_usd) || 2.5;
      const cBs = Number((cUsd * TASA_OCT).toFixed(2));
      const pUsd = Number((cUsd * 1.35).toFixed(2));
      const pBs = Number((pUsd * TASA_OCT).toFixed(2));
      const totUsd = Number((line.cantSalida * pUsd).toFixed(2));
      const totBs = Number((line.cantSalida * pBs).toFixed(2));

      await client.execute({
        sql: `INSERT INTO movimiento_detalles (
                movimiento_id, producto_id, cantidad,
                costo_unitario_usd, costo_unitario_bs,
                precio_unitario_divisa, precio_unitario_bs,
                tasa_bcv_operacion, base_imponible_bs, base_imponible_divisa,
                total_linea_bs, total_linea_divisa
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          movId, line.prod.id, line.cantSalida,
          cUsd, cBs,
          pUsd, pBs,
          TASA_OCT, totBs, totUsd,
          totBs, totUsd
        ]
      });
      itemsSalOct++;
    }
  }

  console.log(`\n=== RESUMEN DE CARGA COMPLETADA ===`);
  console.log(`Septiembre 2026 Compras: ${movsEntSep} movimientos, ${itemsEntSep} detalles`);
  console.log(`Septiembre 2026 Ventas:  ${movsSalSep} movimientos, ${itemsSalSep} detalles`);
  console.log(`Octubre 2026 Ventas:     ${movsSalOct} movimientos, ${itemsSalOct} detalles`);
  console.log(`Total detalles cargados: ${itemsEntSep + itemsSalSep + itemsSalOct}`);
}

run().catch(console.error);

