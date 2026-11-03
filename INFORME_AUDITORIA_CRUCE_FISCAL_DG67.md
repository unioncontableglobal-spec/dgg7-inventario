# INFORME DE AUDITORÍA DE INVENTARIO Y FISCALIDAD (DG67)
## Carga de Entradas y Salidas (Sep - Oct 2026), Diagnóstico de Inconsistencias y Corrección de Filtro al Corte

**Fecha de Auditoría:** 3 de Noviembre de 2026  
**Empresa Auditada:** INVERSIONES DG 67, C.A. (RIF: J-50700865-7)  
**Asesores Auditores:** UNIÓN CONTABLE GLOBAL  
**Sistema:** SISCON-ES DG67 / Cloudflare Serverless + Turso Cloud Engine  

---

### 1. Resumen Ejecutivo de la Auditoría

Se procedió a la revisión exhaustiva del archivo proporcionado `1. SISTEMA DE INVENTARIO - DG67CA sep y oct 26.xlsx`, a la auditoría del comportamiento del filtro de inventario por corte mensual y al análisis de las inconsistencias en el registro de costos operativos por parte de la tienda.

---

### 2. Hallazgos Críticos de la Auditoría

#### Hallazgo 1: Omisión Sistemática del Costo de Compra y Precio de Venta (Confirmación)
* **Condición Detectada:** En la hoja `2. REGISTRO ENTRADAS - SALIDAS`, de un total de 2.499 filas de movimientos físicos cargadas por la tienda desde febrero hasta octubre 2026, **el 100% de las entradas operativas (279 compras) y de las salidas (1.584 ventas) fueron registradas con la columna "COSTO" (Columna 9) completamente vacía o en cero**.
* **Causa Raíz:** El personal de la tienda solo anota el código del repuesto, la cantidad y la referencia del documento (ej. *"FACT 2260"*, *"NOTA ENTREGA"*, *"FACT 2223"*), omitiendo los costos de factura. Únicamente las 664 filas del Inventario Inicial (diciembre 2025) poseían costos unitarios registrados.
* **Solución Aplicada en el Motor Contable:** 
  1. Se vinculó cada línea con el **costo referencial unitario en USD** fijado en el catálogo maestro (`productos.costo_referencial_usd`).
  2. Se convirtió a Bolívares utilizando la **tasa oficial BCV de cierre del período correspondiente** (Septiembre: **Bs. 859,0629**; Octubre: **Bs. 889,5800**), garantizando que ningún movimiento quede en cero y manteniendo la coherencia fiscal con la Providencia SENIAT SNAT/2026/00093 y el Artículo 177 del RISLR.

#### Hallazgo 2: Diagnóstico y Solución del Filtro por Mes en el Inventario al Corte
* **Problema Reportado por el Usuario:** Al seleccionar en el menú desplegable *"Cierre Febrero 2026"*, *"Cierre Marzo 2026"*, etc., los saldos en el banner superior no cambiaban y la tasa oficial se mantenía congelada en la tasa del día (Bs. 889,26).
* **Causa Raíz Técnica:** En la función de borde (`/api/productos`), el endpoint omitía la lectura del parámetro `fecha_corte` y siempre consultaba la vista en tiempo real (`vista_inventario_actual`) aplicando la tasa activa del día.
* **Corrección Efectuada:**
  1. Se reprogramó la consulta para que, al recibir `fecha_corte`, consulte dinámicamente la tabla `tasas_bcv_periodo` para extraer la **tasa oficial de cierre y su fecha exacta** de vigencia (ej. Febrero 2026 &rarr; **Bs. 417,3579** al 27/02/2026).
  2. Se calcula de forma acumulativa el stock histórico a esa fecha:
     $$\text{Stock al Corte} = \sum (\text{Inicial} + \text{Compras}) - \sum (\text{Ventas})$$
     limitando los movimientos a $m.\text{fecha} \le \text{fecha\_corte}$.
  3. Los valores en Bolívares y Dólares del banner superior y de la tabla se recalculan al instante.

#### Hallazgo 3: Incorporación de 2 Nuevos Repuestos al Catálogo
Durante el procesamiento de Septiembre 2026, se detectaron 2 códigos que no existían en el catálogo original:
* **Código `698`:** *LUCES LED FENIZ* (Categoría: ILUMINACIÓN / BOMBILLOS, Proveedor: *Inversiones Partzeus 0605, C.A.*). Costo referencial fijado: **$12.00 USD**.
* **Código `599`:** *FLASHER 2 PT* (Categoría: RELÉ / FLASHER, Proveedor: *Alexander Mariño*). Costo referencial fijado: **$4.50 USD**.
* **Impacto:** El catálogo general pasó de 731 a **733 repuestos activos**.

#### Hallazgo 4: Errores Tipográficos Corregidos en el Archivo Fuente
* **Año 2029:** Se identificaron 11 líneas en el mes de agosto con fecha registrada en el año `2029-08` debido a error de digitación en la tienda. Fueron normalizadas a `2026-08`.
* **Filas Fantasma:** Las últimas 11 filas de la hoja (filas 2895 a 2905) contenían únicamente la fecha `2026-10-31` sin código ni mercancía. Fueron filtradas para no alterar las auditorías.

---

### 3. Detalle de Movimientos Procesados y Sincronizados a Turso Cloud

Se cargaron exitosamente **346 movimientos** y **411 líneas de detalle**:

| Período | Tipo de Movimiento | Cantidad Movimientos | Unidades Físicas | Valor Total ($ USD) | Valor Total (Bs.) | Tasa BCV Cierre |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Septiembre 2026** | **Compras (Entradas)** | 18 | 2.326 und | $1,803.31 USD | Bs. 1.549.153,82 | Bs. 859,0629 |
| **Septiembre 2026** | **Ventas (Salidas)** | 180 | 211 und | $5,470.99 USD | Bs. 4.699.924,23 | Bs. 859,0629 |
| **Octubre 2026** | **Ventas (Salidas)** | 148 | 186 und | $970.01 USD | Bs. 862.901,50 | Bs. 889,5800 |

---

### 4. Trazabilidad Mensual Consolidada (2025-12 a 2026-10)

| Mes / Período | Tasa BCV Cierre | Compras ($ USD) | Compras (Bs.) | Ventas ($ USD) | Ventas (Bs.) | Unidades Compradas | Unidades Vendidas |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **2025-12 (Base)** | Bs. 298,1431 | $35,314.23 | Bs. 10.528.692,12 | $0.00 | Bs. 0,00 | 4.451 und | 0 und |
| **2026-01** | Bs. 367,3069 | $0.00 | Bs. 0,00 | $460.00 | Bs. 168.961,17 | 0 und | 184 und |
| **2026-02** | Bs. 417,3579 | $1,452.50 | Bs. 606.212,35 | $647.50 | Bs. 270.239,24 | 581 und | 259 und |
| **2026-03** | Bs. 473,8702 | $367.23 | Bs. 174.020,57 | $440.00 | Bs. 208.502,89 | 461 und | 176 und |
| **2026-04** | Bs. 487,1192 | $576.96 | Bs. 281.048,79 | $507.50 | Bs. 247.212,99 | 336 und | 203 und |
| **2026-05** | Bs. 549,3716 | $2,825.50 | Bs. 1.552.250,72 | $495.00 | Bs. 271.938,94 | 476 und | 198 und |
| **2026-06** | Bs. 623,0223 | $93.41 | Bs. 58.198,52 | $482.50 | Bs. 300.608,26 | 0 und | 193 und |
| **2026-07** | Bs. 746,6297 | $77.95 | Bs. 58.198,52 | $317.50 | Bs. 237.054,93 | 15 und | 127 und |
| **2026-08** | Bs. 794,9917 | $490.76 | Bs. 390.145,42 | $675.00 | Bs. 536.619,40 | 0 und | 270 und |
| **2026-09** | Bs. 859,0629 | $1,803.31 | Bs. 1.549.153,82 | $5,470.99 | Bs. 4.699.924,23 | 2.326 und | 211 und |
| **2026-10** | Bs. 889,5800 | $0.00 | Bs. 0,00 | $970.01 | Bs. 862.901,50 | 0 und | 186 und |

---

### 5. Recomendaciones para el Contador y la Gerencia

1. **Implementar Registro Obligatorio de Costos en Almacén:**
   Instruir al personal encargado del inventario que no se limite a colocar *"NOTA ENTREGA"* o número de factura en las observaciones; debe registrarse el costo unitario de compra o adjuntar la copia digital de la factura fiscal para evitar imputaciones presuntivas en fiscalizaciones SENIAT.
2. **Conciliación de Entradas con Facturas Fiscales:**
   En Septiembre se identificó que la Factura **00002260** de Alexander Mariño Vargas (`V-14518599-4`) por **Bs. 502.844,75** ingresó físicamente bajo la anotación *"FACT 2260"*. Es indispensable mantener esta trazabilidad cruzada mes a mes.
3. **Cierre Fiscal de Octubre 2026:**
   Dado que en octubre no se registraron compras de mercancía pero sí 186 unidades vendidas, el inventario físico cerró en **6.639 unidades**.
