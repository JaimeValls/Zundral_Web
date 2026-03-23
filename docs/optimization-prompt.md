# ZUNDRAL — Prompt de Optimización Conservadora

## CONTEXTO

**Stack:** React 18.2 + TypeScript + Vite 5 + Tailwind CSS
**Archivo principal:** `src/ResourceVillageUI.tsx` — 7,770 líneas, 65 useState, 23 useEffect, 142 funciones
**Regla:** Solo branch `main`, todo en un commit limpio

---

## INSTRUCCIONES GENERALES

Eres un optimizador de código **conservador**. Tu objetivo es mejorar sin romper.

**Reglas absolutas:**
1. **NO cambiar lógica de juego** — Los números, fórmulas, tiempos y costes NO se tocan
2. **NO reorganizar componentes** — No extraer a nuevos archivos ni crear nuevos hooks
3. **NO refactorizar arquitectura** — No convertir useState a useReducer ni cambiar patrones de estado
4. **Cada cambio debe ser atómico** — Si un cambio falla, los demás siguen funcionando
5. **Antes de cada cambio, evalúa qué puede romperse** y escríbelo explícitamente

---

## FASE 1 — LIMPIEZA DE CONSOLE STATEMENTS (66 total)

### Qué hacer
Crear un sistema de debug condicional y reemplazar los 66 console.log/warn/error existentes.

**Paso 1:** Al inicio de `ResourceVillageUI.tsx`, añadir:
```typescript
const DEBUG = import.meta.env.DEV; // true en desarrollo, false en producción
const dbg = {
  log: (...args: any[]) => DEBUG && console.log(...args),
  warn: (...args: any[]) => DEBUG && console.warn(...args),
  error: (...args: any[]) => DEBUG && console.error(...args),
};
```

**Paso 2:** Reemplazar todos los `console.log(` por `dbg.log(`, `console.warn(` por `dbg.warn(`, `console.error(` por `dbg.error(`.

**NO tocar:** Los console.error que estén dentro de catch blocks de errores críticos (persistence, battle simulator).

### Riesgo
| Qué puede romperse | Probabilidad | Impacto |
|---|---|---|
| Algún console.log usa return value | Muy baja | Bajo — console.log devuelve undefined igual que dbg.log |
| Se pierde un log importante en producción | Baja | Bajo — error handling no depende de logs |

### Test después de este paso
- [ ] El juego arranca sin errores en consola roja
- [ ] Abrir consola del navegador: se ven logs con prefijo [BANNER DEBUG], [PERSISTENCE], etc. (en dev)
- [ ] Crear un banner, asignar pikemen, entrenar → logs de training aparecen
- [ ] Hacer build (`npm run build`) → sin errores

---

## FASE 2 — ELIMINAR CÓDIGO MUERTO Y TODOs VACÍOS

### Qué hacer
Buscar y limpiar:

1. **`totalPlayTime`** (línea ~894): Se serializa pero nunca se incrementa. Dejarlo como está (es backward-compatible) pero añadir comentario `// NOTE: Not currently tracked, kept for save compatibility`

2. **Variables no usadas** dentro de funciones: Buscar variables declaradas con `const` o `let` que nunca se referencian después.

3. **Imports no usados**: Verificar que todos los imports se usan. Si alguno no se usa, comentarlo (no borrarlo, por si acaso).

### Riesgo
| Qué puede romperse | Probabilidad | Impacto |
|---|---|---|
| Borrar algo que sí se usa indirectamente | Media | Alto — podría romper features |
| TypeScript marcaría error si se borra un tipo usado | Nula | El compilador lo detecta |

### Test después de este paso
- [ ] `npm run build` compila sin errores ni warnings nuevos
- [ ] El juego carga el save existente correctamente (no pierde datos)
- [ ] Todas las tabs funcionan: Buildings, Army, Missions, Expeditions, Council, Factions, Blacksmith, Technologies, Leaderboard

---

## FASE 3 — MEMOIZACIÓN DE CÁLCULOS REPETIDOS

### Qué hacer
Identificar cálculos que se repiten cada render y envolverlos en `useMemo`.

**Candidatos seguros (ya se calculan cada render):**

1. **Total workers actual** — Se calcula en múltiples sitios:
```typescript
const currentActualWorkers = lumberMill.workers + quarry.workers + farm.workers;
```
→ Extraer a un `useMemo`:
```typescript
const totalAssignedWorkers = useMemo(() =>
  lumberMill.workers + quarry.workers + farm.workers + ironMine.workers,
  [lumberMill.workers, quarry.workers, farm.workers, ironMine.workers]
);
```

2. **Training banners count** — Se filtra en múltiples sitios:
```typescript
const currentlyTraining = banners.filter(b => b.type === 'regular' && b.status === 'training').length;
```
→ Extraer a useMemo:
```typescript
const trainingBannerCount = useMemo(() =>
  banners.filter(b => b.type === 'regular' && b.status === 'training').length,
  [banners]
);
```

3. **Building upgrade affordability** — Se calcula en render para cada building.

### Riesgo
| Qué puede romperse | Probabilidad | Impacto |
|---|---|---|
| useMemo con deps incorrectas → valor stale | Media | Alto — cálculos incorrectos en UI |
| Rendimiento peor si el memo es más caro que recalcular | Baja | Bajo — son sumas simples |

### Mitigación
- **Verificar que TODAS las variables usadas dentro del useMemo están en el dependency array**
- Si hay duda, NO memoizar — el cálculo raw es más seguro

### Test después de este paso
- [ ] Asignar/desasignar workers en Lumber Mill, Quarry, Farm → valores actualizan correctamente
- [ ] Crear banner → entrenar → el contador de training slots es correcto
- [ ] Subir edificio de nivel → el coste se recalcula bien
- [ ] Comprobar que la población muestra el número correcto en el top bar

---

## FASE 4 — ELIMINAR RECREACIÓN INNECESARIA DE OBJETOS EN RENDER

### Qué hacer
Buscar objetos/arrays creados inline en JSX que causan re-renders innecesarios:

```tsx
// MAL — crea nuevo objeto cada render
<Component style={{ color: 'red' }} />
<Component data={[1, 2, 3]} />
<Component onClick={() => doSomething(id)} />
```

**Solo arreglar los que:**
- Se pasen a componentes hijos que usen `React.memo`
- Estén dentro de loops (`.map()`) generando listas grandes
- Sean objetos complejos (no strings/numbers simples)

**NO arreglar:**
- Callbacks simples en elementos HTML nativos (`<button onClick={...}>`)
- Props de componentes que NO usan `React.memo`

### Riesgo
| Qué puede romperse | Probabilidad | Impacto |
|---|---|---|
| useCallback con deps incorrectas → función stale | Alta | Alto — handlers no actualizan |
| Optimización prematura sin beneficio real | Media | Bajo — solo pierde tiempo |

### Mitigación
- **Solo aplicar donde haya beneficio medible** (loops con 10+ items)
- **Nunca usar useCallback en handlers de eventos de elementos HTML nativos**

### Test después de este paso
- [ ] Crear 3 banners con múltiples squads → UI responde fluida
- [ ] Abrir lista de misiones → las 3 misiones renderizan bien
- [ ] Hacer scroll por buildings → no hay lag
- [ ] Entrenar banner → progress bar avanza smooth

---

## FASE 5 — OPTIMIZAR GAME LOOP (ALTO RIESGO — MÁXIMA PRECAUCIÓN)

### Qué hacer
El game loop (useEffect con setInterval cada 1000ms) tiene un dependency array enorme (~30 dependencias). Cada cambio de cualquier dependencia destruye y recrea el interval.

**Optimización conservadora:**
1. Mover valores que NO cambian frecuentemente a `useRef` en vez de leerlos del closure
2. Usar `useRef` para los valores que cambian cada segundo (population, banners) y leer desde `.current` dentro del interval

**PERO**: Esta es la parte más peligrosa. Si los refs no se sincronizan bien, el game loop lee datos stale.

### Riesgo
| Qué puede romperse | Probabilidad | Impacto |
|---|---|---|
| Refs no sincronizados → game loop lee datos viejos | Alta | CRÍTICO — toda la economía se rompe |
| Interval no se recrea cuando debe → ignora cambios | Media | Alto — workers no producen |
| Memory leak si interval no se limpia | Baja | Medio — rendimiento degrada |

### Mitigación
- **SOLO mover a refs los valores estáticos** (rates, caps) que raramente cambian
- **NUNCA mover banners o population a refs** — son demasiado dinámicos
- Si hay CUALQUIER duda, NO hacer este paso

### Test después de este paso (EXHAUSTIVO)
- [ ] Recursos suben cada segundo (wood, stone, food, iron, gold)
- [ ] Cambiar workers en lumber mill → producción cambia inmediatamente
- [ ] Subir edificio de nivel → rates se recalculan
- [ ] Entrenar banner → consume pop y iron cada segundo
- [ ] Misión en progreso → timer avanza → batalla se resuelve
- [ ] Dejar el juego 5 minutos → recursos acumulados correctamente
- [ ] Recargar página → save cargado con valores correctos
- [ ] Comprobar que la población no crece ni decrece de forma anómala

---

## FASE 6 — CHECKLIST DE VERIFICACIÓN FINAL

Después de TODAS las fases, ejecutar esta checklist completa:

### Core Loop
- [ ] Recursos suben cada segundo
- [ ] Food se consume (farm storage primero, warehouse después)
- [ ] Población crece si hay food, decrece si no hay
- [ ] Pop nunca baja de 1 (emergency rule)
- [ ] Gold se genera por taxes según nivel de impuestos

### Buildings
- [ ] Todos los edificios se construyen (Town Hall → House → Warehouse → Barracks → etc.)
- [ ] Workers se asignan/desasignan correctamente
- [ ] Upgrade cuesta wood + stone y el coste escala por nivel
- [ ] Collect resources funciona en lumber mill, quarry, iron mine

### Army
- [ ] Crear banner → 8 slots vacíos
- [ ] Asignar unidad a slot → squad aparece con 0/maxSize
- [ ] Entrenar banner → consume pop + iron → squad sube a maxSize
- [ ] Banner pasa a READY cuando está lleno
- [ ] Mercenarios: pagar gold → llegan por queue → banner ready

### Missions
- [ ] 3 misiones visibles
- [ ] Asignar banner → deploy → timer corre → batalla → resultado
- [ ] Victoria: rewards (gold, resources, XP)
- [ ] Derrota: banner sufre casualties

### Expeditions
- [ ] Fundar expedición consume recursos
- [ ] Launch → fortress aparece
- [ ] Garrison se puede asignar

### Persistence
- [ ] Save manual funciona
- [ ] Auto-save funciona (cambiar algo → recargar → cambio persiste)
- [ ] Load game no pierde datos antiguos (backward compatibility)

### UI
- [ ] Todas las 9 tabs abren sin error
- [ ] Responsive: no se rompe en ventana pequeña
- [ ] No hay errores rojos en consola del navegador
- [ ] Build de producción (`npm run build`) sin errores

---

## ORDEN DE EJECUCIÓN RECOMENDADO

```
FASE 1 → test → commit
FASE 2 → test → commit
FASE 3 → test → commit
FASE 4 → test → commit (opcional, solo si hay beneficio claro)
FASE 5 → test EXHAUSTIVO → commit (SOLO si todo lo anterior pasó)
FASE 6 → verificación final completa
```

**Cada fase es un commit independiente.** Si una fase falla, se revierte sin afectar las anteriores.

---

## COSAS QUE NO SE TOCAN (EXPLÍCITO)

- ❌ No reorganizar archivos ni crear nuevos componentes
- ❌ No cambiar de useState a useReducer
- ❌ No tocar las fórmulas de gameFormulas.ts ni constants.ts
- ❌ No cambiar el battleSimulator.ts
- ❌ No tocar persistence.ts (serialización/deserialización)
- ❌ No cambiar CSS ni layout
- ❌ No modificar types.ts
- ❌ No cambiar la estructura del save game (localStorage)
