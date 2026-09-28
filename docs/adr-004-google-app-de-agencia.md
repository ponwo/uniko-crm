# ADR-004 — La agenda admite la app de Google de la agencia: un cliente por negocio y `lanco.cloud` como único retorno

**Estado**: aceptado (2026-09-28, con la ratificación de la enmienda 1.8.0 al
mergear ponwo/uniko-crm#42) · **Fecha**: 2026-09-27 · **Feature**:
[`029-google-por-link`](../specs/029-google-por-link/spec.md)

## Contexto

La 015 metió Google Calendar + Meet como conector opcional con un modelo **BYO**:
cada negocio crea su proyecto en Google Cloud y pega tres datos. Funciona —LanCo lo
conectó así el 2026-09-23—, pero cuesta veinte minutos de consola técnica con dos
trampas (modo prueba que caduca a los 7 días; un permiso que no autoriza lo que
parece), y **ningún cliente de la flota puede hacerlo solo**.

Con Meta, LanCo resolvió el mismo problema con una app de agencia y un link de alta
en `lanco.cloud`. Con Google hay una diferencia que manda sobre todo lo demás:
**la instancia necesita el secreto de la app en cada renovación del acceso**, no
solo al darse de alta. En Meta la app intermedia para conseguir el token y
desaparece; en Google, si la app es de LanCo, su secreto tiene que vivir en las
instancias.

Y la constitución (II.3.4, 1.4.0) decía: *"jamás credenciales de una plataforma
central"*.

## Decisión

**1. Un proyecto de Google de LanCo, con un cliente OAuth POR NEGOCIO.** El proyecto
(LanCo Robotics, `lanco-robotics`; app «LanCo Agenda») lleva la marca, la pantalla de
consentimiento, el dominio autorizado y la verificación: se hacen una vez para
todos. Cada negocio tiene su propio cliente OAuth dentro, configurado en SU instancia
por despliegue (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`). Una fuga compromete a un negocio; rotar o dar de baja
toca una instancia.

**2. `lanco.cloud` es el único URI de redirección, y solo reenvía.** Registrar el
retorno de cada instancia obligaría a añadir y verificar en el proyecto de LanCo cada
dominio de cliente. En su lugar, Google vuelve a `lanco.cloud`, que lee el origen de
la instancia en el `state` y reenvía el navegador allí, solo si la instancia está en
la lista de la flota. Página estática: sin servidor, sin almacenamiento, sin
secretos.

**3. La instancia canjea el permiso ella misma.** El `code` que ve `lanco.cloud` no
sirve sin el secreto, que solo tiene la instancia. El refresh token no pasa por
ninguna persona ni por ningún sistema de LanCo. Una vez conectada, la instancia habla
con Google directo, como en BYO: `lanco.cloud` no está en el camino de ninguna cita.

**4. El link de alta es de un solo uso, revocable y lo genera el dueño.** Es una
llave: quien la tenga puede conectar SU calendario y recibir ahí las citas del
negocio. Vence a las 72 horas, se guarda solo su huella y generar uno nuevo revoca el
anterior.

**5. BYO sigue en pie.** La tarjeta manual de la 015 no cambia, y una instancia sin
la app de agencia es exactamente la de antes. Un self-hoster puede usar el mismo
link con su propia app apuntando el retorno a su instancia, sin `lanco.cloud`.

**6. La constitución se enmienda, no se esquiva** (1.8.0, II.3.4): la app puede ser
del operador de la flota solo con cliente por negocio, permiso solo en la instancia,
nada central en runtime y BYO disponible.

## Lo que se descartó

- **n8n canjea y guarda el token (como el alta de Meta).** Deja el permiso de cada
  cliente y los secretos de todos en un sistema central, y a una persona copiándolos
  a Uniko. Descartado por el dueño el 2026-09-27.
- **Un solo cliente OAuth para toda la flota.** Su secreto en todas las instancias:
  una fuga abre a todos, y rotarlo es tocar la flota entera.
- **Intermediario en runtime** (la instancia le pide el acceso a `lanco.cloud` en
  cada cita). Quita el secreto de las instancias, pero si `lanco.cloud` cae nadie
  genera enlaces: justo lo que el Principio II existe para impedir.
- **Registrar el retorno de cada instancia en el proyecto de LanCo.** Obliga a
  verificar en Search Console cada dominio de cliente (`ilovetheuniverse.mx`,
  `nuriaandrea.com`, …) dentro del proyecto de LanCo. Es el trabajo que el relevo
  ahorra.
- **Seguir solo con BYO.** Es lo que hay hoy, y deja la agenda con Meet fuera del
  alcance de los clientes de la flota.

## Consecuencias

- Una instancia default no cambia: sin las tres variables, la superficie del link no
  existe.
- Dar de alta un negocio suma pasos del operador: crear su cliente OAuth (a mano:
  Google no ofrece API para eso), configurar tres variables en su instancia y añadir
  su host a la lista de la flota en `lanco-ws`. Guía:
  [google-agencia.md](google-agencia.md).
- LanCo asume la verificación de la app ante Google (una vez, para todos) y el
  cumplimiento de su política de datos de usuario en `lanco.cloud`.
- Mientras la app no esté verificada, los titulares ven el aviso de Google; la página
  de aterrizaje lo anticipa.
- Revocar a un negocio es borrar su cliente OAuth en la consola: todos sus permisos
  mueren a la vez sin tocar a nadie más.
- `lanco.cloud` pasa a ser parte del alta de Google de la flota: su caída detiene las
  altas nuevas, nunca la operación. El contrato que lo ata a Uniko vive en
  [contracts/relevo-lanco-cloud.md](../specs/029-google-por-link/contracts/relevo-lanco-cloud.md).
