# 🚐 Camionetica

Paga tu pasaje de camioneta escaneando un QR y mira en el mapa dónde vienen las unidades, en vivo.

- **Pasajeros** (`/`): registro con número de celular y PIN, billetera en Bs, recarga por Pago Móvil, pago por QR con ticket digital, historial y mapa de unidades cercanas.
- **Choferes** (`/chofer.html`): inician turno, envían su GPS desde el celular y ven cada pago al momento.
- **Administración** (`/admin.html`): flota, QR imprimibles, tarifa y datos de Pago Móvil.

Hecho por Kromatik.

## Correr en tu computadora

1. Instala [Node.js](https://nodejs.org/es) (versión LTS).
2. Doble clic en **ABRIR CAMIONETICA.bat** (Windows), o en una terminal: `npm install` y luego `npm start`.
3. Abre http://localhost:3000

Cuenta de prueba: teléfono `0412 000 0000`, PIN `1234`. Chofer: unidad `BUS-001`, clave `1234`.

## Publicarla en internet (Render, gratis)

1. Entra a https://render.com e inicia sesión con tu cuenta de GitHub.
2. **New → Blueprint** y elige este repositorio. Render lee `render.yaml` y crea el servicio.
3. Cuando pida `DATABASE_URL`, pega la conexión de una base PostgreSQL gratuita de https://neon.tech (si lo dejas vacío funciona igual, pero los datos se borran cada vez que el servidor se reinicia).
4. La clave de administrador queda en **Environment → ADMIN_KEY**.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `PORT` | Puerto (Render lo pone solo) |
| `ADMIN_KEY` | Clave del panel de administración |
| `DATABASE_URL` | PostgreSQL donde se guardan los datos (opcional) |
