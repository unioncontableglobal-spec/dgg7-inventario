#!/usr/bin/env python3
"""
MIGRATION AND DATA CLEANING SCRIPT FOR INVERSIONES DG 67, C.A.
Target: Turso (libSQL) / SQLite Relational Database
"""

import os
import re
import sqlite3
import datetime
import openpyxl
from collections import defaultdict

BASE_DIR = '/Users/leydizerpa/Desktop/SISTEMAS CONTABLES/DGG7 INV ENTR Y SALIDA'
F1_PATH = os.path.join(BASE_DIR, '1. SISTEMA DE INVENTARIO - DG67CA INV INI Y ENE26.xlsx')
F2_PATH = os.path.join(BASE_DIR, '1. SISTEMA DE INVENTARIO - DG67CA FEB A AGOS 26.xlsx')

DB_PATH = os.path.join(BASE_DIR, 'inventario_dg67.db')
SQL_DUMP_PATH = os.path.join(BASE_DIR, 'inventario_dg67.sql')

# Normalization maps
PROVIDER_ALIASES = {
    'aa center 2024, c.a.': ('J-50544719-0', 'AA Center 2024, C.A.'),
    'alexander mariño': ('J-14518599-4', 'Alexander Mariño'),
    'autopartesjafenza,c.a': ('J-40727176-6', 'Autopartes Jafenza, C.A.'),
    'bazar el costo, c.a.': ('J-29571911-6', 'Bazar el Costo, C.A.'),
    'blindac': ('J-29902184-9', 'Blindac'),
    'disbattery lubricantes, s.a.': ('J-41310543-8', 'Disbattery Lubricantes, S.A.'),
    'disbattery lubricantes': ('J-41310543-8', 'Disbattery Lubricantes, S.A.'),
    'distribudora global, c.a': ('J-31726604-8', 'Distribuidora Global 2014, C.A.'),
    'distribudora global c.a': ('J-31726604-8', 'Distribuidora Global 2014, C.A.'),
    'distrbudora global': ('J-31726604-8', 'Distribuidora Global 2014, C.A.'),
    'distribuidora global 2014, c.a.': ('J-31726604-8', 'Distribuidora Global 2014, C.A.'),
    'distribuidora tools light, c.a.': ('J-41142994-5', 'Distribuidora Tools Light, C.A.'),
    'distribudora tools light c,a': ('J-41142994-5', 'Distribuidora Tools Light, C.A.'),
    'distrbudora tool c.a': ('J-41142994-5', 'Distribuidora Tools Light, C.A.'),
    'grupo federal c.a': ('J-31620000-0', 'Grupo Federal Century, C.A.'),
    'grupo federal century, c.a.': ('J-31620000-0', 'Grupo Federal Century, C.A.'),
    'importadora la chispa de speed 7, c.a.': ('J-40149434-0', 'Importadora La Chispa De Speed 7, C.A.'),
    'inverciones leuviah 19 c.a': ('J-31287942-4', 'Inversiones Leuviah 19, C.A.'),
    'inversiones leuviah 19 c.a': ('J-31287942-4', 'Inversiones Leuviah 19, C.A.'),
    'inversiones angelinev, c.a.': ('J-30865927-4', 'Inversiones Angelinev, C.A.'),
    'inverciones angalinev c.a': ('J-30865927-4', 'Inversiones Angelinev, C.A.'),
    'inversiones partzeus 0605, c.a.': ('J-50346453-4', 'Inversiones Partzeus 0605, C.A.'),
    'iverciones partezus c.a': ('J-50346453-4', 'Inversiones Partzeus 0605, C.A.'),
    'isopartes 2014, c.a.': ('J-40718468-7', 'Isopartes 2014, C.A.'),
    'maquinas fiscales, c.a.': ('J-31231536-9', 'Maquinas Fiscales, C.A.'),
    'mayor de repuestos asiaticos,  c.a.': ('J-31550747-9', 'Mayor de Repuestos Asiaticos, C.A.'),
    'mundo movil i, c.a.': ('J-40888534-4', 'Mundo Movil I, C.A.'),
    'remaveca c.a': ('J-41168433-3', 'Remaveca, C.A.'),
    'remaveca': ('J-41168433-3', 'Remaveca, C.A.'),
    'samymotors, c.a.': ('J-31550747-1', 'SamyMotors, C.A.'),
    'samy motors, c.a.': ('J-31550747-1', 'SamyMotors, C.A.'),
    'union contable': ('J-000256862-3', 'Union Contable'),
    'volta electropartes, c.a.': ('J-40656000-6', 'Volta Electropartes, C.A.'),
    'volta eletropartes.c.a': ('J-40656000-6', 'Volta Electropartes, C.A.'),
}

def clean_str(val):
    if val is None:
        return ''
    return str(val).strip()

def clean_float(val):
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    # Handle strings like '$2,50', '2.50', '2,50', '$11.00.70'
    s = str(val).replace('$', '').strip()
    s = s.replace(',', '.')
    # If multiple dots, keep only the first dot as decimal separator
    parts = s.split('.')
    if len(parts) > 2:
        s = parts[0] + '.' + ''.join(parts[1:])
    try:
        return float(s)
    except ValueError:
        return 0.0

def parse_date(val):
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        d = val.strftime('%Y-%m-%d')
    elif isinstance(val, (int, float)):
        try:
            d = (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(val))).strftime('%Y-%m-%d')
        except:
            return None
    else:
        s = str(val).strip()
        if '/' in s:
            p = s.split('/')
            if len(p) == 3:
                # Assuming D/M/Y or Y/M/D
                if len(p[2]) == 4:
                    d = f'{p[2]}-{int(p[1]):02d}-{int(p[0]):02d}'
                elif len(p[0]) == 4:
                    d = f'{p[0]}-{int(p[1]):02d}-{int(p[2]):02d}'
                else:
                    d = s
            else:
                d = s
        else:
            d = s

    # Fix typo year 2029 -> 2026
    if d and d.startswith('2029-'):
        d = '2026-' + d[5:]
    return d

def main():
    print("=== STARTING DATA CLEANING & MIGRATION ===")
    
    # 1. Connect to SQLite database
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 2. Build Schema
    print("Creating relational schema in SQLite / Turso dialect...")
    cur.executescript("""
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS empresas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rif TEXT UNIQUE NOT NULL,
        razon_social TEXT NOT NULL,
        domicilio_fiscal TEXT,
        telefono TEXT
    );

    CREATE TABLE IF NOT EXISTS almacenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS proveedores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rif TEXT UNIQUE NOT NULL,
        razon_social TEXT NOT NULL,
        contacto TEXT,
        activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo TEXT UNIQUE NOT NULL,
        descripcion TEXT NOT NULL,
        unidad_medida TEXT NOT NULL DEFAULT 'UND',
        categoria_id INTEGER REFERENCES categorias(id),
        almacen_id INTEGER REFERENCES almacenes(id),
        stock_minimo REAL DEFAULT 1.0,
        costo_referencial_usd REAL DEFAULT 0.0,
        activo INTEGER DEFAULT 1,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movimientos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL CHECK(tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA', 'SALIDA_VENTA', 'AJUSTE')),
        fecha DATE NOT NULL,
        numero_documento TEXT,
        proveedor_id INTEGER REFERENCES proveedores(id),
        observaciones TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS movimiento_detalles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movimiento_id INTEGER NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        cantidad REAL NOT NULL CHECK(cantidad > 0),
        costo_unitario_usd REAL DEFAULT 0.0
    );

    CREATE INDEX idx_productos_codigo ON productos(codigo);
    CREATE INDEX idx_movimientos_fecha ON movimientos(fecha);
    CREATE INDEX idx_movimientos_tipo ON movimientos(tipo);
    CREATE INDEX idx_mov_detalles_prod ON movimiento_detalles(producto_id);

    CREATE VIEW vista_inventario_actual AS
    SELECT 
        p.id AS producto_id,
        p.codigo,
        p.descripcion,
        p.unidad_medida,
        COALESCE(c.nombre, 'GENERAL') AS categoria,
        COALESCE(a.nombre, 'PRINCIPAL') AS almacen,
        p.stock_minimo,
        p.costo_referencial_usd,
        ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
        END), 0), 2) AS stock_actual,
        ROUND(COALESCE(SUM(CASE 
            WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
            WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
            ELSE 0 
        END), 0) * p.costo_referencial_usd, 2) AS valor_total_usd,
        CASE 
            WHEN COALESCE(SUM(CASE 
                WHEN m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA') THEN md.cantidad 
                WHEN m.tipo = 'SALIDA_VENTA' THEN -md.cantidad 
                ELSE 0 
            END), 0) <= p.stock_minimo THEN 'SOLICITAR MATERIAL'
            ELSE 'HAY SUFICIENTE'
        END AS estado_stock
    FROM productos p
    LEFT JOIN categorias c ON p.categoria_id = c.id
    LEFT JOIN almacenes a ON p.almacen_id = a.id
    LEFT JOIN movimiento_detalles md ON p.id = md.producto_id
    LEFT JOIN movimientos m ON md.movimiento_id = m.id
    GROUP BY p.id;
    """)

    # Insert Company Info
    cur.execute("""
    INSERT INTO empresas (rif, razon_social, domicilio_fiscal)
    VALUES ('J-50700865-7', 'INVERSIONES DG 67, C.A.', 'AV SUR 11 ENTRE LAS ESQUINA BOLIVAR Y MIRANDA CASA NRO 112 LOCAL S/N URB SAN AGUSTIN DEL NORTE CARACAS DISTRITO CAPITAL ZONA POSTAL 1010');
    """)

    # Insert Warehouses
    for w_code in ['AUTOPERIQUITOS', 'MULTIMARCAS']:
        cur.execute("INSERT OR IGNORE INTO almacenes (codigo, nombre) VALUES (?, ?)", (w_code, w_code))
    
    conn.commit()

    # Load workbooks
    print("Loading Excel workbooks...")
    wb1 = openpyxl.load_workbook(F1_PATH, data_only=True)
    wb2 = openpyxl.load_workbook(F2_PATH, data_only=True)

    # 3. Process Categories & Providers
    print("Extracting and normalizing Providers and Categories...")
    category_map = {} # name -> id
    provider_map = {} # normalized key -> id

    # Register known providers
    for prov_key, (rif, rz) in PROVIDER_ALIASES.items():
        cur.execute("INSERT OR IGNORE INTO proveedores (rif, razon_social) VALUES (?, ?)", (rif, rz))
        cur.execute("SELECT id FROM proveedores WHERE rif = ?", (rif,))
        pid = cur.fetchone()[0]
        provider_map[prov_key] = pid

    def get_or_create_provider(raw_name):
        if not raw_name:
            return None
        norm = str(raw_name).strip().lower()
        if norm in provider_map:
            return provider_map[norm]
        # Check alias partial match
        for k, pid in provider_map.items():
            if k in norm or norm in k:
                return pid
        # Create new
        clean_name = str(raw_name).strip()
        dummy_rif = 'J-PROV-' + re.sub(r'[^A-Za-z0-9]', '', clean_name)[:8].upper()
        cur.execute("INSERT OR IGNORE INTO proveedores (rif, razon_social) VALUES (?, ?)", (dummy_rif, clean_name))
        cur.execute("SELECT id FROM proveedores WHERE razon_social = ?", (clean_name,))
        row = cur.fetchone()
        pid = row[0] if row else None
        provider_map[norm] = pid
        return pid

    def get_or_create_category(raw_cat):
        cname = str(raw_cat).strip().upper() if raw_cat else 'GENERAL'
        if not cname:
            cname = 'GENERAL'
        if cname in category_map:
            return category_map[cname]
        cur.execute("INSERT OR IGNORE INTO categorias (nombre) VALUES (?)", (cname,))
        cur.execute("SELECT id FROM categorias WHERE nombre = ?", (cname,))
        cid = cur.fetchone()[0]
        category_map[cname] = cid
        return cid

    def get_almacen_id(raw_alm):
        aname = str(raw_alm).strip().upper() if raw_alm else 'AUTOPERIQUITOS'
        if 'MULTI' in aname:
            code = 'MULTIMARCAS'
        else:
            code = 'AUTOPERIQUITOS'
        cur.execute("SELECT id FROM almacenes WHERE codigo = ?", (code,))
        return cur.fetchone()[0]

    # 4. Extract Products from Catalog Sheets
    print("Extracting and deduplicating Product Catalog...")
    product_rows = {} # code -> dict
    
    # Process File 1 and File 2 Catalog sheets
    for ws in [wb1['1. INVENTARIO AL DÍA'], wb2['1. INVENTARIO AL DÍA']]:
        for r in range(12, ws.max_row + 1):
            raw_code = ws.cell(r, 2).value
            raw_desc = ws.cell(r, 3).value
            raw_und = ws.cell(r, 4).value
            raw_cost = ws.cell(r, 5).value
            raw_cat = ws.cell(r, 6).value
            raw_alm = ws.cell(r, 7).value
            raw_smin = ws.cell(r, 8).value

            if not raw_code and not raw_desc:
                continue

            code_clean = clean_str(raw_code).upper()
            desc_clean = clean_str(raw_desc)
            if not code_clean:
                continue

            # Special duplicate code handling
            if code_clean == '5338':
                if 'SABO' in desc_clean.upper():
                    code_clean = '5338-SABO'
                else:
                    code_clean = '5338'

            # Excel auto-fill drag artifact: Code 660 with desc 661, 661 with desc 662...
            if code_clean == '660' and desc_clean == '661':
                continue # Skip draft row; real row 708 has 'PILA 7A028N'
            if code_clean == '661' and desc_clean == '662':
                continue # Skip draft row; real row 712 has 'PORTA FUCIBLE VAQUELITA'
            if code_clean == '662' and desc_clean == '663':
                continue # Skip draft row; real row 713 has 'RELAY 4P MARREON FIETAS'
            if code_clean == '659' and desc_clean == '660':
                continue
            if code_clean == '679' and 'BOMBILLOS' in desc_clean.upper():
                code_clean = '679-HAL' # Differentiate from FLASHER ECONOMICO 3P

            # Duplicate consecutive rows in original Excel
            if code_clean in product_rows:
                # Merge / update if description or cost is richer
                if not product_rows[code_clean]['desc'] and desc_clean:
                    product_rows[code_clean]['desc'] = desc_clean
                if product_rows[code_clean]['cost'] == 0 and clean_float(raw_cost) > 0:
                    product_rows[code_clean]['cost'] = clean_float(raw_cost)
            else:
                product_rows[code_clean] = {
                    'code': code_clean,
                    'desc': desc_clean,
                    'und': clean_str(raw_und).upper() or 'UND',
                    'cost': clean_float(raw_cost),
                    'cat': clean_str(raw_cat).upper() or 'GENERAL',
                    'alm': clean_str(raw_alm).upper() or 'AUTOPERIQUITOS',
                    'stock_min': clean_float(raw_smin) or 1.0
                }

    print(f"Total unique products consolidated: {len(product_rows)}")

    # Insert products into database
    product_id_map = {} # code -> id
    for code, p in product_rows.items():
        cid = get_or_create_category(p['cat'])
        aid = get_almacen_id(p['alm'])
        cur.execute("""
        INSERT INTO productos (codigo, descripcion, unidad_medida, categoria_id, almacen_id, stock_minimo, costo_referencial_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (p['code'], p['desc'], p['und'], cid, aid, p['stock_min'], p['cost']))
        product_id_map[code] = cur.lastrowid

    conn.commit()

    # 5. Migrate Initial Inventory (Closing 31/12/2025)
    print("Migrating Initial Inventory at 31/12/2025...")
    ws1_mov = wb1['2. REGISTRO ENTRADAS - SALIDAS']
    
    # Create master initial inventory movement header
    cur.execute("""
    INSERT INTO movimientos (tipo, fecha, numero_documento, observaciones)
    VALUES ('INVENTARIO_INICIAL', '2025-12-31', 'INV-INI-2025-12-31', 'Inventario inicial auditado al cierre fiscal 31/12/2025')
    """)
    inv_ini_mov_id = cur.lastrowid

    ini_count = 0
    ini_units = 0.0
    for r in range(11, ws1_mov.max_row + 1):
        dt = parse_date(ws1_mov.cell(r, 3).value)
        raw_code = ws1_mov.cell(r, 4).value
        raw_desc = ws1_mov.cell(r, 5).value
        raw_cost = clean_float(ws1_mov.cell(r, 8).value)
        raw_in = ws1_mov.cell(r, 10).value
        
        if dt == '2025-12-31' and raw_code:
            code_clean = clean_str(raw_code).upper()
            if code_clean == '5338':
                if 'SABO' in clean_str(raw_desc).upper():
                    code_clean = '5338-SABO'
                else:
                    code_clean = '5338'

            qty = clean_float(raw_in)
            if qty > 0 and code_clean in product_id_map:
                prod_id = product_id_map[code_clean]
                cur.execute("""
                INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd)
                VALUES (?, ?, ?, ?)
                """, (inv_ini_mov_id, prod_id, qty, raw_cost))
                ini_count += 1
                ini_units += qty

    conn.commit()
    print(f"  -> Initial inventory loaded: {ini_count} lines, {ini_units:.1f} total units.")

    # 6. Migrate Movements: January 2026 (File 1)
    print("Migrating January 2026 movements from File 1...")
    jan_count = 0
    for r in range(11, ws1_mov.max_row + 1):
        dt = parse_date(ws1_mov.cell(r, 3).value)
        if not dt or dt == '2025-12-31':
            continue # Already handled in initial inventory
        
        raw_code = ws1_mov.cell(r, 4).value
        raw_desc = ws1_mov.cell(r, 5).value
        raw_prov = ws1_mov.cell(r, 6).value
        raw_cost = clean_float(ws1_mov.cell(r, 8).value)
        raw_fact = clean_str(ws1_mov.cell(r, 9).value)
        raw_in = clean_float(ws1_mov.cell(r, 10).value)
        raw_out = clean_float(ws1_mov.cell(r, 11).value)
        raw_obs = clean_str(ws1_mov.cell(r, 12).value)

        code_clean = clean_str(raw_code).upper()
        if code_clean == '5338':
            if 'SABO' in clean_str(raw_desc).upper():
                code_clean = '5338-SABO'
        
        if not code_clean or code_clean not in product_id_map:
            continue

        prod_id = product_id_map[code_clean]
        prov_id = get_or_create_provider(raw_prov)

        if raw_out > 0:
            doc = raw_fact or 'VENTA-ENE-2026'
            cur.execute("""
            INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones)
            VALUES ('SALIDA_VENTA', ?, ?, ?, ?)
            """, (dt, doc, prov_id, raw_obs))
            m_id = cur.lastrowid
            cur.execute("""
            INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd)
            VALUES (?, ?, ?, ?)
            """, (m_id, prod_id, raw_out, raw_cost))
            jan_count += 1
        elif raw_in > 0:
            doc = raw_fact or 'COMPRA-ENE-2026'
            cur.execute("""
            INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones)
            VALUES ('ENTRADA_COMPRA', ?, ?, ?, ?)
            """, (dt, doc, prov_id, raw_obs))
            m_id = cur.lastrowid
            cur.execute("""
            INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd)
            VALUES (?, ?, ?, ?)
            """, (m_id, prod_id, raw_in, raw_cost))
            jan_count += 1

    conn.commit()
    print(f"  -> January 2026 movements loaded: {jan_count} transactions.")

    # 7. Migrate Movements: February to August 2026 (File 2)
    print("Migrating February to August 2026 movements from File 2...")
    ws2_mov = wb2['2. REGISTRO ENTRADAS - SALIDAS']
    
    feb_aug_count = 0
    # Notice: rows 400 to 1085 were un-dated re-paste of initial stock -> SKIP
    # Real dated transactions start at row 1086 through 2495
    for r in range(1086, ws2_mov.max_row + 1):
        dt = parse_date(ws2_mov.cell(r, 5).value)
        if not dt:
            continue

        raw_code = ws2_mov.cell(r, 6).value
        raw_desc = ws2_mov.cell(r, 7).value
        raw_prov = ws2_mov.cell(r, 8).value
        raw_cost = clean_float(ws2_mov.cell(r, 10).value)
        raw_fact = clean_str(ws2_mov.cell(r, 11).value) or clean_str(ws2_mov.cell(r, 14).value)
        raw_in = clean_float(ws2_mov.cell(r, 12).value)
        raw_out = clean_float(ws2_mov.cell(r, 13).value)
        raw_obs = clean_str(ws2_mov.cell(r, 14).value)

        code_clean = clean_str(raw_code).upper()
        if code_clean == '5338':
            if 'SABO' in clean_str(raw_desc).upper():
                code_clean = '5338-SABO'

        # Auto-create product if code exists in movements but wasn't in catalog sheet
        if code_clean not in product_id_map and code_clean:
            cid = get_or_create_category('GENERAL')
            aid = get_almacen_id('AUTOPERIQUITOS')
            cur.execute("""
            INSERT INTO productos (codigo, descripcion, unidad_medida, categoria_id, almacen_id, costo_referencial_usd)
            VALUES (?, ?, 'UND', ?, ?, ?)
            """, (code_clean, clean_str(raw_desc) or f'Repuesto {code_clean}', cid, aid, raw_cost))
            product_id_map[code_clean] = cur.lastrowid

        if code_clean not in product_id_map:
            continue

        prod_id = product_id_map[code_clean]
        prov_id = get_or_create_provider(raw_prov)

        if raw_out > 0:
            doc = raw_fact or f'VENTA-{dt}'
            cur.execute("""
            INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones)
            VALUES ('SALIDA_VENTA', ?, ?, ?, ?)
            """, (dt, doc, prov_id, raw_obs))
            m_id = cur.lastrowid
            cur.execute("""
            INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd)
            VALUES (?, ?, ?, ?)
            """, (m_id, prod_id, raw_out, raw_cost))
            feb_aug_count += 1
        elif raw_in > 0:
            doc = raw_fact or f'COMPRA-{dt}'
            cur.execute("""
            INSERT INTO movimientos (tipo, fecha, numero_documento, proveedor_id, observaciones)
            VALUES ('ENTRADA_COMPRA', ?, ?, ?, ?)
            """, (dt, doc, prov_id, raw_obs))
            m_id = cur.lastrowid
            cur.execute("""
            INSERT INTO movimiento_detalles (movimiento_id, producto_id, cantidad, costo_unitario_usd)
            VALUES (?, ?, ?, ?)
            """, (m_id, prod_id, raw_in, raw_cost))
            feb_aug_count += 1

    conn.commit()
    print(f"  -> Feb - Aug 2026 movements loaded: {feb_aug_count} transactions.")

    # 8. Verification and Metrics
    print("\n=== POST-MIGRATION AUDIT & INTEGRITY CHECK ===")
    cur.execute("SELECT COUNT(*) FROM productos")
    total_prods = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM proveedores")
    total_provs = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM categorias")
    total_cats = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM movimientos")
    total_movs = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM movimiento_detalles")
    total_items = cur.fetchone()[0]

    cur.execute("SELECT SUM(cantidad) FROM movimiento_detalles md JOIN movimientos m ON md.movimiento_id = m.id WHERE m.tipo IN ('INVENTARIO_INICIAL', 'ENTRADA_COMPRA')")
    total_in_units = cur.fetchone()[0] or 0

    cur.execute("SELECT SUM(cantidad) FROM movimiento_detalles md JOIN movimientos m ON md.movimiento_id = m.id WHERE m.tipo = 'SALIDA_VENTA'")
    total_out_units = cur.fetchone()[0] or 0

    cur.execute("SELECT SUM(valor_total_usd) FROM vista_inventario_actual WHERE stock_actual > 0")
    total_val = cur.fetchone()[0] or 0

    print(f"Total Products in DB:   {total_prods}")
    print(f"Total Suppliers in DB:  {total_provs}")
    print(f"Total Categories in DB: {total_cats}")
    print(f"Total Movements:        {total_movs}")
    print(f"Total Item Details:     {total_items}")
    print(f"Total Units Ingested:   {total_in_units:.1f}")
    print(f"Total Units Sold:       {total_out_units:.1f}")
    print(f"Net Positive Stock Val: ${total_val:,.2f} USD")

    # 9. Dump to SQL script for Turso CLI import
    print(f"\nGenerating SQL script dump at: {SQL_DUMP_PATH}...")
    with open(SQL_DUMP_PATH, 'w', encoding='utf-8') as f:
        for line in conn.iterdump():
            f.write(f"{line}\n")

    conn.close()
    print("=== MIGRATION COMPLETE SUCCESSFULLY ===")

if __name__ == '__main__':
    main()
