import { Transform } from 'class-transformer';

/**
 * Turns the `"true"` / `"false"` a query string carries into a real boolean.
 *
 * Anything else is passed through untouched so the `@IsBoolean()` next to it
 * still rejects it — `Boolean("false")` would otherwise be `true`.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }): unknown => {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  });
}
