# Устранение ошибки 'Cannot read properties of null (reading 'offset')'

## Проблема
Бот спамит ошибкой `Cannot read properties of null (reading 'offset')`. Анализ кода показал, что наиболее вероятное место ошибки — функция `placeAndCraft` в `api/bot/decision.ts`:
```typescript
const blockAbove = bot.blockAt(b.position.offset(0, 1, 0));
```
Здесь `b` (блок) может быть валидным, но `b.position` — это `Vec3`. Ошибка "reading offset of null" говорит о том, что объект, у которого вызывается `.offset`, равен `null`.
Если `b` приходит из `bot.findBlock`, то `b` не должен быть `null`.
Однако, если `findBlock` вызывает `matching` для блоков, которые не загружены или находятся за пределами мира, может прийти странное состояние.

Но более вероятно, что ошибка происходит в проверке:
```typescript
if (b.position.equals(botPos) || b.position.equals(botPos.offset(0, -1, 0)))
```
Если `botPos` (`bot.entity.position.floored()`) каким-то образом оказался `null` (хотя мы проверяли `bot.entity` ранее), это вызовет ошибку.

Но самое подозрительное место — это использование `b.position.offset` внутри колбэка `matching`. Если `mineflayer` передает `null` в качестве `b` (что маловероятно, но возможно при ошибках чанков), то `b.position` упадет.

## Решение
1.  **Добавить защиту от null**: В функции `matching` внутри `placeAndCraft` добавить проверку `if (!b || !b.position) return false;`.
2.  **Проверить `botPos`**: Убедиться, что `botPos` определен перед использованием.

## Шаги реализации
1.  **`api/bot/decision.ts`**:
    -   Обновить `matching` функцию в `placeAndCraft`.
    -   Добавить `if (!b || !b.position) return false;`.
    -   Обернуть вызов `bot.blockAt` в `try-catch` или проверить результат на `null`.

Это устранит спам ошибками и позволит боту продолжить работу.
