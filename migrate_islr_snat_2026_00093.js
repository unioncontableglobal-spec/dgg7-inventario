/**
 * MIGRACIÓN Y SEMILLA: MÓDULO DE COMPROBANTES DE RETENCIÓN DE ISLR
 * Normativa: Providencia Administrativa SNAT/2026/00093 (Gaceta Oficial N° 43.484) y Decreto 1.808
 */
import { createClient } from '@libsql/client';

const db = createClient({ url: 'file:inventario_dg67.db' });

async function runMigration() {
  console.log('Iniciando migración PA SNAT/2026/00093 y Decreto 1.808 (Retenciones ISLR)...');

  // 1. Extender tabla proveedores con campos obligatorios PA SNAT/2026/00093
  const alterProveedores = [
    "ALTER TABLE proveedores ADD COLUMN tipo_persona TEXT DEFAULT 'PJ-D'",
    "ALTER TABLE proveedores ADD COLUMN direccion_fiscal TEXT DEFAULT ''",
    "ALTER TABLE proveedores ADD COLUMN codigo_concepto_islr TEXT DEFAULT '055'"
  ];

  for (const sql of alterProveedores) {
    try {
      await db.execute(sql);
      console.log('OK:', sql);
    } catch (e) {
      if (!e.message.includes('duplicate column')) {
        console.warn('Warn:', e.message);
      }
    }
  }

  // Actualizar tipo_persona según RIF (V/E -> PN-R, J/G -> PJ-D) y datos de proveedores conocidos
  await db.execute(`
    UPDATE proveedores 
    SET tipo_persona = CASE 
      WHEN rif LIKE 'V%' OR rif LIKE 'E%' THEN 'PN-R' 
      ELSE 'PJ-D' 
    END
    WHERE tipo_persona IS NULL OR tipo_persona = ''
  `);

  // Actualizar datos reales de UNION GLOBAL 333, C.A. del Excel Retenciones ISLR.xlsx
  await db.execute({
    sql: `
      UPDATE proveedores 
      SET direccion_fiscal = ?,
          email = COALESCE(NULLIF(email, ''), ?),
          telefono = COALESCE(NULLIF(telefono, ''), ?),
          tipo_persona = 'PJ-D',
          codigo_concepto_islr = '055'
      WHERE rif = 'J-50714716-9'
    `,
    args: [
      'ESQ. QUESERA A NIQUITAO, EDIF. PARQUE CARABOBO PLAZA, TORRE A PISO 15, APTO. 15A2, URB. SAN AGUSTÍN DEL NORTE, CARACAS',
      'facturacion@unioncontableglobal.com',
      '0212-5760000'
    ]
  });

  // Asegurar correo y dirección por defecto en proveedores para cumplimiento PA SNAT/2026/00093
  const provs = await db.execute("SELECT id, rif, razon_social, email, direccion_fiscal, tipo_servicio FROM proveedores");
  for (const p of provs.rows) {
    const cleanSlug = String(p.razon_social || 'proveedor')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 18) || 'proveedor';
    const defaultEmail = p.email && p.email.trim() ? p.email.trim() : `administracion@${cleanSlug}.com.ve`;
    const defaultDir = p.direccion_fiscal && p.direccion_fiscal.trim()
      ? p.direccion_fiscal.trim()
      : 'CARACAS, DISTRITO CAPITAL, REPÚBLICA BOLIVARIANA DE VENEZUELA';
    const tipoPers = (String(p.rif || '').startsWith('V') || String(p.rif || '').startsWith('E')) ? 'PN-R' : 'PJ-D';
    const codIslr = p.tipo_servicio === 'SERVICIOS_CONTABLES_Y_LEGALES'
      ? (tipoPers === 'PN-R' ? '001' : '055')
      : (p.tipo_servicio === 'SERVICIOS_TECNICOS_Y_SISTEMAS' ? '053' : '055');

    await db.execute({
      sql: `UPDATE proveedores SET email = ?, direccion_fiscal = ?, tipo_persona = ?, codigo_concepto_islr = ? WHERE id = ?`,
      args: [defaultEmail, defaultDir, tipoPers, codIslr, p.id]
    });
  }

  // 2. Tabla de Configuración Fiscal y Parámetros PA SNAT/2026/00093 (UT, Agente de Retención, Imprenta Digital)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS config_fiscal_islr (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      agente_razon_social TEXT DEFAULT 'INVERSIONES DG 67, C.A.',
      agente_rif TEXT DEFAULT 'J-50700865-7',
      agente_direccion TEXT DEFAULT 'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS',
      agente_telefono TEXT DEFAULT '0212-5771122',
      agente_email TEXT DEFAULT 'administracion@inversionesdg67.com.ve',
      valor_ut_bs REAL DEFAULT 43.00,
      factor_sustraendo REAL DEFAULT 83.3334,
      aplica_imprenta_digital INTEGER DEFAULT 1,
      imprenta_razon_social TEXT DEFAULT 'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.',
      imprenta_rif TEXT DEFAULT 'J-50714716-9',
      imprenta_providencia TEXT DEFAULT 'SNAT/2026/00093-AUT-00418',
      imprenta_fecha_asignacion TEXT DEFAULT '01/01/2026 08:00:00'
    )
  `);

  await db.execute(`
    INSERT OR IGNORE INTO config_fiscal_islr (
      id, agente_razon_social, agente_rif, agente_direccion, agente_telefono, agente_email,
      valor_ut_bs, factor_sustraendo, aplica_imprenta_digital,
      imprenta_razon_social, imprenta_rif, imprenta_providencia, imprenta_fecha_asignacion
    ) VALUES (
      1,
      'INVERSIONES DG 67, C.A.',
      'J-50700865-7',
      'AV. SUR 11 ENTRE LAS ESQUINAS BOLÍVAR Y MIRANDA, CASA NRO. 112, LOCAL S/N, URB. SAN AGUSTÍN DEL NORTE, CARACAS',
      '0212-5771122',
      'administracion@inversionesdg67.com.ve',
      43.00,
      83.3334,
      1,
      'UNIÓN CONTABLE GLOBAL SISTEMAS DIGITALES, C.A.',
      'J-50714716-9',
      'SNAT/2026/00093-AUT-00418',
      '01/01/2026 08:00:00'
    )
  `);

  // 3. Tabla Maestra de Conceptos Decreto 1.808 SENIAT
  await db.execute(`
    CREATE TABLE IF NOT EXISTS conceptos_islr_seniat (
      codigo TEXT PRIMARY KEY,
      descripcion TEXT NOT NULL,
      tipo_persona TEXT NOT NULL,
      pct_base REAL NOT NULL DEFAULT 100.0,
      pct_tarifa REAL NOT NULL DEFAULT 2.0,
      aplica_sustraendo INTEGER NOT NULL DEFAULT 0,
      literal_decreto TEXT DEFAULT ''
    )
  `);

  const conceptosDecreto1808 = [
    ['001', 'Honorarios Profesionales No Mercantiles (Persona Natural Residente)', 'PN-R', 100.0, 3.0, 1, 'Art. 9 Lit. 1b'],
    ['002', 'Honorarios Profesionales No Mercantiles (Persona Natural No Residente)', 'PN-NR', 90.0, 34.0, 0, 'Art. 9 Lit. 1a'],
    ['003', 'Honorarios Profesionales No Mercantiles (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 5.0, 0, 'Art. 9 Lit. 1b'],
    ['014', 'Comisiones Mercantiles y Otras Comisiones (Persona Natural Residente)', 'PN-R', 100.0, 3.0, 1, 'Art. 9 Lit. 2a'],
    ['016', 'Comisiones Mercantiles y Otras Comisiones (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 5.0, 0, 'Art. 9 Lit. 2b'],
    ['027', 'Arrendamiento de Bienes Inmuebles (Persona Natural Residente)', 'PN-R', 100.0, 3.0, 1, 'Art. 9 Lit. 4a'],
    ['029', 'Arrendamiento de Bienes Inmuebles (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 5.0, 0, 'Art. 9 Lit. 4b'],
    ['031', 'Arrendamiento de Bienes Muebles (Persona Natural Residente)', 'PN-R', 100.0, 3.0, 1, 'Art. 9 Lit. 5a'],
    ['033', 'Arrendamiento de Bienes Muebles (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 5.0, 0, 'Art. 9 Lit. 5b'],
    ['039', 'Fletes y Transporte Nacional de Carga (Persona Natural Residente)', 'PN-R', 100.0, 1.0, 1, 'Art. 9 Lit. 7a'],
    ['041', 'Fletes y Transporte Nacional de Carga (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 3.0, 0, 'Art. 9 Lit. 7b'],
    ['047', 'Publicidad y Propaganda Comercial (Persona Natural Residente)', 'PN-R', 100.0, 3.0, 1, 'Art. 9 Lit. 9a'],
    ['049', 'Publicidad y Propaganda Comercial (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 5.0, 0, 'Art. 9 Lit. 9b'],
    ['053', 'Ejecución de Obras y Prestación de Servicios (Persona Natural Residente)', 'PN-R', 100.0, 1.0, 1, 'Art. 9 Lit. 11a'],
    ['055', 'Ejecución de Obras, Servicios y Asesoría Administrativa/Técnica (Persona Jurídica Domiciliada)', 'PJ-D', 100.0, 2.0, 0, 'Art. 9 Lit. 11b']
  ];

  for (const c of conceptosDecreto1808) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO conceptos_islr_seniat (codigo, descripcion, tipo_persona, pct_base, pct_tarifa, aplica_sustraendo, literal_decreto) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: c
    });
  }

  // 4. Tabla de Comprobantes de Retención ISLR (Encabezado PA SNAT/2026/00093)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS retenciones_islr (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nro_comprobante TEXT NOT NULL UNIQUE,
      periodo TEXT NOT NULL,
      fecha_emision TEXT NOT NULL,
      hora_emision TEXT NOT NULL,
      proveedor_id INTEGER,
      sujeto_rif TEXT NOT NULL,
      sujeto_razon_social TEXT NOT NULL,
      sujeto_tipo_persona TEXT NOT NULL DEFAULT 'PJ-D',
      sujeto_direccion TEXT NOT NULL,
      sujeto_email TEXT NOT NULL,
      sujeto_telefono TEXT DEFAULT '',
      concepto_general TEXT DEFAULT 'SERVICIOS Y ASESORÍA ADMINISTRATIVA',
      codigo_concepto_principal TEXT DEFAULT '055',
      es_multimoneda INTEGER DEFAULT 0,
      moneda_divisa TEXT DEFAULT 'USD',
      tasa_bcv REAL DEFAULT 68.50,
      valor_ut_aplicado REAL DEFAULT 43.00,
      total_documento_bs REAL NOT NULL DEFAULT 0,
      total_base_imponible_bs REAL NOT NULL DEFAULT 0,
      total_sustraendo_bs REAL NOT NULL DEFAULT 0,
      total_islr_retenido_bs REAL NOT NULL DEFAULT 0,
      total_a_pagar_bs REAL NOT NULL DEFAULT 0,
      estatus TEXT DEFAULT 'EMITIDO',
      observaciones TEXT DEFAULT '',
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Tabla de Detalles del Comprobante de Retención ISLR (Líneas de Factura / Documento)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS retenciones_islr_detalles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retencion_id INTEGER NOT NULL,
      libro_compra_id INTEGER,
      nro_operacion INTEGER NOT NULL DEFAULT 1,
      fecha_factura TEXT NOT NULL,
      nro_factura TEXT NOT NULL,
      nro_control TEXT NOT NULL,
      nro_nota_debito TEXT DEFAULT '',
      nro_nota_credito TEXT DEFAULT '',
      tipo_transaccion TEXT DEFAULT '01-REG',
      codigo_concepto TEXT NOT NULL DEFAULT '055',
      descripcion_concepto TEXT NOT NULL,
      monto_total_bs REAL NOT NULL DEFAULT 0,
      base_imponible_bs REAL NOT NULL DEFAULT 0,
      pct_base REAL NOT NULL DEFAULT 100.0,
      pct_tarifa REAL NOT NULL DEFAULT 2.0,
      sustraendo_bs REAL NOT NULL DEFAULT 0,
      impuesto_retenido_bs REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (retencion_id) REFERENCES retenciones_islr(id) ON DELETE CASCADE
    )
  `);

  // 6. Sembrar los Comprobantes Históricos 2026 desde libro_compras y Retenciones ISLR.xlsx
  // En Retenciones ISLR.xlsx (Hoja SEP26), el comprobante de Septiembre 2026 es 20260900000009 (Union Global 333, C.A., Factura 000013, Nro Control 00-00000014, Total 230330.41, Base 198560.70, 2%, Retenido 3971.21)
  const existingCount = await db.execute("SELECT COUNT(*) as c FROM retenciones_islr");
  if (Number(existingCount.rows[0].c) === 0) {
    console.log('Sembrando comprobantes de retención ISLR históricos (Enero - Septiembre 2026)...');

    const facturasServicios = await db.execute(`
      SELECT lc.*, p.id as prov_id, p.direccion_fiscal, p.email, p.telefono, p.tipo_persona
      FROM libro_compras lc
      LEFT JOIN proveedores p ON lc.rif = p.rif
      WHERE lc.rif = 'J-50714716-9'
      ORDER BY lc.periodo ASC, lc.id ASC
    `);

    const tasasPorMes = {
      '2026-01': 53.50,
      '2026-02': 55.20,
      '2026-03': 57.10,
      '2026-04': 58.90,
      '2026-05': 60.40,
      '2026-06': 62.10,
      '2026-07': 63.80,
      '2026-08': 65.90,
      '2026-09': 67.40,
      '2026-10': 68.50
    };

    // Mapa del secuencial según el Excel Retenciones ISLR.xlsx (donde Septiembre es 20260900000009)
    const seqPorPeriodo = {
      '2026-01': '20260100000001',
      '2026-02': '20260200000002',
      '2026-03': '20260300000003',
      '2026-04': '20260400000004',
      '2026-05': '20260500000005',
      '2026-08': '20260800000008',
      '2026-09': '20260900000009'
    };

    let fallbackSeq = 1;
    for (const f of facturasServicios.rows) {
      const per = f.periodo;
      const yyyymm = per.replace('-', '');
      const nroComp = seqPorPeriodo[per] || `${yyyymm}${String(fallbackSeq).padStart(8, '0')}`;
      fallbackSeq++;

      // Formatear fecha a DD/MM/AAAA
      const parts = String(f.fecha || `${per}-28`).split('-');
      const fechaDDMMYYYY = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '30/09/2026';
      const horaEmision = per === '2026-09' ? '16:45:12' : '15:30:00';

      const base = Number(f.base_imponible_bs || 0);
      const total = Number(f.total_bs || 0);
      const pctBase = 100.0;
      const pctTarifa = 2.0;
      const sustraendo = 0.0;
      const retenido = Number(((base * (pctBase / 100) * (pctTarifa / 100)) - sustraendo).toFixed(2));
      const netoPagar = Number((total - retenido - Number(f.iva_retenido_bs || 0)).toFixed(2));
      const tasa = tasasPorMes[per] || 67.40;

      const nroFacturaLimpio = (f.nro_factura && !String(f.nro_factura).startsWith('OP-'))
        ? f.nro_factura
        : `00000${fallbackSeq}`;
      const nroControlLimpio = f.nro_control && f.nro_control.trim()
        ? f.nro_control.trim()
        : `00-000000${String(fallbackSeq).padStart(2, '0')}`;

      const insHeader = await db.execute({
        sql: `
          INSERT INTO retenciones_islr (
            nro_comprobante, periodo, fecha_emision, hora_emision,
            proveedor_id, sujeto_rif, sujeto_razon_social, sujeto_tipo_persona,
            sujeto_direccion, sujeto_email, sujeto_telefono,
            concepto_general, codigo_concepto_principal,
            es_multimoneda, moneda_divisa, tasa_bcv, valor_ut_aplicado,
            total_documento_bs, total_base_imponible_bs, total_sustraendo_bs,
            total_islr_retenido_bs, total_a_pagar_bs, estatus, observaciones
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          nroComp,
          per,
          fechaDDMMYYYY,
          horaEmision,
          f.prov_id || 36,
          'J-50714716-9',
          'UNION GLOBAL 333, C.A.',
          'PJ-D',
          'ESQ. QUESERA A NIQUITAO, EDIF. PARQUE CARABOBO PLAZA, TORRE A PISO 15. APTO. 15A2 URB. SAN AGUSTIN DEL NORTE, CARACAS',
          'facturacion@unioncontableglobal.com',
          '0212-5760000',
          'ASESORIA ADMINISTRATIVA',
          '055',
          0,
          'USD',
          tasa,
          43.00,
          total,
          base,
          sustraendo,
          retenido,
          netoPagar,
          'EMITIDO',
          'ASESORIA 360 GLOBAL - CFT'
        ]
      });

      const retId = Number(insHeader.lastInsertRowid);

      await db.execute({
        sql: `
          INSERT INTO retenciones_islr_detalles (
            retencion_id, libro_compra_id, nro_operacion,
            fecha_factura, nro_factura, nro_control,
            nro_nota_debito, nro_nota_credito, tipo_transaccion,
            codigo_concepto, descripcion_concepto,
            monto_total_bs, base_imponible_bs, pct_base, pct_tarifa,
            sustraendo_bs, impuesto_retenido_bs
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          retId,
          f.id,
          1,
          fechaDDMMYYYY,
          nroFacturaLimpio,
          nroControlLimpio,
          '',
          '',
          '01-REG',
          '055',
          'ASESORIA 360 GLOBAL - CFT',
          total,
          base,
          pctBase,
          pctTarifa,
          sustraendo,
          retenido
        ]
      });
    }
    console.log('Comprobantes históricos sembrados exitosamente.');
  }

  console.log('Migración PA SNAT/2026/00093 completada.');
}

runMigration().catch(err => {
  console.error('Error en migración ISLR:', err);
  process.exit(1);
});
