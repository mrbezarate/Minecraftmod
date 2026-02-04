# Исправление ошибок TypeScript и таймаутов еды

## Проблема
1.  **Ошибка `Failed to eat: Promise timed out`**: Метод `bot.consume()` зависает. Mineflayer иногда требует, чтобы бот не смотрел на блок (активация блока вместо еды) или чтобы предмет был корректно экипирован.
2.  **Ошибки типов**:
    -   `'Vec3' refers to a value...`: Неправильный импорт `vec3`.
    -   `path_reset` not assignable: Лишнее событие.
    -   `currentTask` type mismatch: TypeScript сузил тип `currentTask` до литерала, и теперь ругается на сравнение.

## Решение

### 1. Исправление импорта `Vec3`
В файлах `api/bot/exploration.ts` и `api/bot/decision.ts`:
Заменить `import Vec3 from 'vec3'` на `import { Vec3 } from 'vec3'`. Если это не сработает (зависит от версии), использовать `const Vec3 = require('vec3')` для надежности, так как проект использует `tsx` и смешанные модули.

### 2. Исправление поедания (`forceEat`)
В `api/bot/survival.ts`:
-   Перед `consume` вызвать `bot.lookAt(bot.entity.position.offset(0, 2, 0))` (посмотреть вверх), чтобы не кликнуть случайно по блоку под ногами (трава, цветы).
-   Обернуть `bot.consume` в `Promise.race` с таймаутом, чтобы не ждать вечно.

### 3. Исправление типов
-   Убрать `bot.removeListener('path_reset', ...)` и подписку на него, так как это событие, видимо, не существует в типах или вообще.
-   В `api/bot/types.ts` или при использовании `currentTask` явно указать тип `string`, чтобы TS не умничал с сужением типов.

## Шаги реализации
1.  **`api/bot/survival.ts`**: Улучшить `forceEat` (взгляд вверх, таймаут).
2.  **`api/bot/exploration.ts`**: Исправить импорт `Vec3`, убрать `path_reset`.
3.  **`api/bot/decision.ts`**: Исправить импорт `Vec3`.

Это должно устранить ошибки компиляции и сделать поедание надежным.
