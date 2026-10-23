# Sistema de Inventario de Entradas y Salidas - INVERSIONES DG 67, C.A.

Sistema web moderno en la nube para el control de inventarios, kárdex y registro de entradas y salidas de repuestos automotrices, conectado directamente a **Turso Cloud (libSQL / SQLite Serverless en el Edge)**.

---

## 🚀 Arquitectura y Tecnologías

* **Base de Datos en la Nube:** Turso Cloud (`inventario-dg67`) en `aws-us-east-1` (libSQL con integridad ACID total y réplicas ultrarrápidas).
* **Backend:** Node.js + Express con API REST modular y transacciones atómicas.
* **Frontend:** Interfaz web moderna responsiva con estética Dark/Glassmorphic, paleta HSL curada, animaciones fluidas y tipografía *Plus Jakarta Sans*.
* **Exportador Contable:** Generador dinámico de hojas Excel (`.xlsx`) en memoria para auditorías y conciliaciones fiscales con el SENIAT.

---

## 📊 Datos Migrados y Auditados

* **Empresa:** INVERSIONES DG 67, C.A. | RIF: `J-50700865-7`
* **Catálogo Maestro:** 731 productos/repuestos normalizados y deduplicados.
* **Proveedores:** 22 proveedores registrados con RIF fiscal.
* **Categorías:** 80 familias de repuestos.
* **Almacenes:** `AUTOPERIQUITOS` y `MULTIMARCAS`.
* **Histórico Cargado:** 1.596 movimientos (Inventario Inicial al 31/12/2025 + Compras y Ventas de Enero a Agosto 2026 hasta la factura `#2222`).
* **Unidades Ingresadas:** 6.320 unidades.
* **Unidades Vendidas:** 1.610 unidades.
* **Valorización Neta en USD:** $29.417,79 USD.

---

## 🛠️ Cómo Iniciar el Sistema Localmente

1. Abre la terminal en esta carpeta:
   ```bash
   cd "/Users/leydizerpa/Desktop/SISTEMAS CONTABLES/DGG7 INV ENTR Y SALIDA"
   ```

2. Inicia el servidor:
   ```bash
   npm start
   ```

3. Abre tu navegador web en:
   👉 **http://localhost:3000**

---

## 📑 Módulos del Sistema

1. **Dashboard & KPIs:**
   * Total de repuestos, unidades en existencia y valorización total en USD.
   * Alertas en vivo para **59 repuestos en stock crítico** ($\le$ mínimo).
   * Gráficos de barras de distribución por categorías y lista de últimos movimientos.

2. **Inventario al Día:**
   * Tabla con los 731 productos con búsqueda predictiva instantánea.
   * Filtros por Almacén, Categoría y Estado de Reposición.
   * Acceso directo al Kardex de cualquier repuesto.

3. **Registrar Entrada (Compras):**
   * Selección de Proveedor (con RIF), fecha y número de factura de compra.
   * Cesta dinámica de repuestos con costo unitario y cálculo de subtotales en tiempo real.
   * Guarda transacciones atómicas en Turso Cloud.

4. **Registrar Salida (Ventas):**
   * Fecha, número de factura fiscal de venta y cliente/observaciones.
   * Indicador en tiempo real del stock disponible para cada repuesto.
   * Validación automática que previene vender más de lo existente.

5. **Kardex por Repuesto:**
   * Cronología completa de entradas, salidas y saldo resultante calculado en tiempo real.

6. **Exportación a Excel:**
   * Descarga con 1 solo clic del inventario valorado para la administración o el contador.
