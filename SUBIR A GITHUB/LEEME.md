# Camionetica · v2

App de transporte público para Caracas: los pasajeros pagan el pasaje escaneando un QR dentro de la camionetica, y los choferes comparten su ubicación en vivo desde su propio celular.

## Cómo arrancarla

```
npm install
npm start
```

Al iniciar, la consola muestra las 3 direcciones y la **clave de administrador**:

| Pantalla | Dirección | Para quién |
|---|---|---|
| App del pasajero | http://localhost:3000/ | Billetera, pago con QR, recargas, recibos, mapa |
| Panel del chofer | http://localhost:3000/chofer.html | Turno, GPS en vivo, pasajeros y recaudado del día |
| Administración | http://localhost:3000/admin.html | Flota, registrar unidades, imprimir QR, tarifa |

### Cuentas de prueba
- **Pasajero:** teléfono `0412 000 0000`, PIN `1234`
- **Choferes:** `BUS-001`, `BUS-002` o `BUS-003`, clave `1234`
- **Códigos QR demo:** `CMT-DEMO01`, `CMT-DEMO02`, `CMT-DEMO03`

## Qué cambió respecto a la v1
- **Cuentas de pasajero** con teléfono y PIN (el PIN se guarda cifrado). Cada persona tiene su propio saldo e historial.
- **Datos que no se pierden:** todo se guarda en `data/db.json` (usuarios, unidades, transacciones). La v1 reiniciaba el saldo cada vez que se apagaba el servidor. El saldo de tu `database.json` viejo se pasa a la cuenta de prueba.
- **QR único por unidad** (`CMT-XXXXXXXX`), como dice la especificación técnica. El pasajero ya no elige el bus de una lista: tiene que escanear el QR que está dentro.
- **Escáner en vivo con la cámara**, más las opciones de leer el QR desde una foto o escribir el código a mano.
- **Protección contra cobros dobles:** si escaneas la misma unidad dos veces en 90 segundos, la app pregunta antes de cobrar otro pasaje.
- **Recargas con número de referencia** del Pago Móvil, y no se puede usar la misma referencia dos veces.
- **Panel del chofer funcional:** la v1 llamaba a `/api/estado-bus`, que no existía. Ahora el chofer inicia el turno, el celular envía su GPS cada 5 segundos, la pantalla se mantiene encendida y suena un aviso con cada pago.
- **Mapa con unidades reales:** las unidades aparecen cuando el chofer está en turno y desaparecen si dejan de enviar GPS por 3 minutos. Las 3 unidades demo se siguen moviendo solas hasta que un chofer real inicie turno con ellas.
- **Panel de administración:** estadísticas del día, lista de la flota, registrar unidades nuevas (genera su QR) e **imprimir el afiche con el QR** para pegarlo en la camionetica, y cambiar la tarifa.
- Los montos se manejan en céntimos para que no haya errores de redondeo.

## Importante antes de usarla con gente real
1. **HTTPS:** los celulares solo permiten usar el GPS y la cámara en páginas con `https://` (o en `localhost`). Para probar desde un teléfono, publícala en un hosting con HTTPS (Render, Railway, un VPS con Caddy) o usa un túnel como `ngrok`.
2. **Las recargas se acreditan al instante** con solo poner la referencia. Eso sirve para la demo, pero en producción la recarga debe quedar *pendiente* hasta verificarla con el banco (conciliación de Pago Móvil o una pasarela de pago).
3. **Base de datos:** `data/db.json` alcanza para el piloto. Con muchos usuarios conviene pasar a PostgreSQL usando las mismas tablas (`usuarios`, `autobuses`, `transacciones`).
4. **Clave de administrador fija:** arranca con `ADMIN_KEY=tu_clave npm start` (en Windows PowerShell: `$env:ADMIN_KEY="tu_clave"; npm start`).

## Estructura de la API
| Método | Ruta | Uso |
|---|---|---|
| POST | /api/auth/registro · /api/auth/login · /api/auth/salir | Cuenta del pasajero |
| GET | /api/me | Saldo, tarifa e historial |
| POST | /api/pagar | Pagar pasaje con el texto del QR |
| POST | /api/recargar | Recargar saldo (monto, método, referencia) |
| GET | /api/buses | Unidades visibles en el mapa |
| POST | /api/chofer/login · /api/chofer/gps · /api/chofer/turno | Chofer |
| GET | /api/chofer/resumen | Pasajeros y recaudado del día |
| GET/POST | /api/admin/resumen · /api/admin/autobuses · /api/admin/tarifa | Administración (cabecera `x-admin-key`) |
