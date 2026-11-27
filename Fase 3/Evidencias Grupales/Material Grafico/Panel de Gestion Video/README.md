# Panel de gestión — imágenes para el video

Imágenes 16:9 del Panel de gestión de CitaJusta preparadas para el video de presentación de Fase 3.

> **Versión gráfica con datos de ejemplo.** No son capturas de la aplicación: es una composición del Panel de gestión hecha para video, con las mismas secciones e indicadores que tiene Desktop (Análisis → Panel de gestión). Los datos son de ejemplo, revisados para que todas las cifras sean coherentes entre sí, y no representan la operación real de una institución. La captura del componente real está en [Panel_de_Gestion_Desktop_datos_de_ejemplo.png](<../../../Evidencias Proyecto/Evidencias de sistema/Aplicación/Panel_de_Gestion_Desktop_datos_de_ejemplo.png>).

| Imagen | Contenido |
| --- | --- |
| [01_panel_completo.png](<01_panel_completo.png>) | Panel completo en una sola pantalla |
| [02_recomendaciones_y_kpis.png](<02_recomendaciones_y_kpis.png>) | Recomendaciones para decidir e indicadores clave |
| [03_actividad_y_estado_citas.png](<03_actividad_y_estado_citas.png>) | Actividad diaria y estado de las citas |
| [04_agenda_espera_servicios.png](<04_agenda_espera_servicios.png>) | Uso de la agenda, lista de espera, servicios y profesionales |

Formatos: 1920 × 1080 en esta carpeta y 3840 × 2160 en [`4K/`](<4K/>).

## Datos de ejemplo

Período 01-11-2026 al 07-11-2026 (7 días):

| Indicador | Valor | Cálculo |
| --- | ---: | --- |
| Citas del período | 20 | 4 agendadas, 9 atendidas, 3 inasistencias, 3 canceladas y 1 en otro estado |
| Asistencia | 75 % | 9 de 12 citas cerradas |
| Inasistencia | 25 % | 3 de 12 citas cerradas |
| Cancelación | 15 % | 3 de 20 citas |
| Ocupación de agenda | 85 % | 17 cupos reservados (citas no canceladas) de 20 |
| Recuperación de cupos | 33,3 % | 1 de 3 cupos liberados (los otros 2: 1 en reasignación y 1 expirado) |
| Ofertas de reasignación | 10 | 1 aceptada, 3 rechazadas, 5 expiradas y 1 pendiente |
| Personas en espera | 5 | Todas en Kinesiología; espera promedio 3,3 días y máxima 9,5 días |

La actividad diaria suma las mismas 20 citas, 3 cancelaciones y 3 inasistencias, y las tablas de servicios y profesionales suman 20 citas y 3 canceladas.

## Cómo regenerarlas

Las imágenes salen de [`fuente/panel-video.html`](<fuente/panel-video.html>). Cada escena se abre agregando `#completo`, `#decisiones`, `#tendencia` u `#operacion` a la dirección y se captura a 1920 × 1080:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --hide-scrollbars --window-size=1920,1080 `
  --run-all-compositor-stages-before-draw --screenshot="01_panel_completo.png" `
  "file:///<ruta al repositorio>/Fase 3/Evidencias Grupales/Material Grafico/Panel de Gestion Video/fuente/panel-video.html#completo"
```

Para la versión 4K se agrega `--force-device-scale-factor=2`.

Volver a [Evidencias Grupales](<../../README.md>).
