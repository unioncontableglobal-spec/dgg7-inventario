# Directrices de Diseño y Visualización Monetaria (SISCON-ES DG67)

## 1. Doble Expresión Monetaria Simultánea (Obligatoria)
* **Moneda Principal:** Todos los importes, costos, totales, saldos y flujos deben presentarse prioritariamente en **Bolívares (Bs.)**.
* **Referencia en Dólares ($ USD):** Todo saldo o monto en Bolívares debe mostrar simultáneamente su contravalor equivalente en Dólares, calculado con la tasa oficial BCV correspondiente.
* **Sin Pestañas ni Botones Excluyentes de Moneda:** En el Dashboard y vistas principales, **NO** colocar selectores o pestañas tipo toggle ("Solo Bs" vs "Solo USD") que oculten una moneda. La cifra en Bs. debe mostrarse de forma prominente con su referencia en $ USD colocada al lado o en un subtexto inferior (`<div class="sub-ref-usd">$X.XX USD</div>`).

## 2. Estructura Limpia del Dashboard de Inicio
* El Dashboard debe ser ejecutivo, simple y visualmente despejado:
  1. **Tasa Oficial BCV del Día:** Widget de actualización diaria visible y editable.
  2. **5 KPIs Ejecutivos:** Valor del Inventario (Bs. + USD), Unidades en Stock, Rotación Anual, Disponibilidad de Stock y Total de Alertas.
  3. **Detalle Mensual de Ventas vs Compras:** Tabla bimonetaria limpia donde cada mes muestra sus compras y ventas en Bs. con su referencia en USD.
  4. **Top 10 Productos Más Vendidos:** Con ranking visual, unidades y monto facturado (Bs. + USD).
* **Exclusiones y Claridad del Inicio:**
  * **Sin Balance Neto Confuso:** No incluir conceptos contables complejos o abstractos en el Dashboard como *"Balance Neto (Bs. / USD)"* ni fórmulas/deltas de compras menos ventas que confundan a la tienda. Utilizar conceptos comerciales directos, claros y positivos: Total Compras, Total Ventas, Promedio Mensual de Facturación y Unidades en Almacén.
  * No incluir tablas operativas densas de alertas de stock como *"⚠️ Radar de Repuestos en Punto de Reorden (Quiebre)"* en el Dashboard inicial. Las alertas operativas detalladas pertenecen al módulo de *"Inventario al Día"*.

