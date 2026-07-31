import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * `oklch(L C H)` with an optional `deg` on the hue and an optional `/ alpha`,
 * e.g. `oklch(0.48 0.13 165)` or `oklch(1 0 0 / 10%)`.
 */
export const OKLCH_PATTERN =
  /^oklch\(\s*\d*\.?\d+%?\s+\d*\.?\d+\s+\d*\.?\d+(?:deg)?\s*(?:\/\s*\d*\.?\d+%?\s*)?\)$/;

@ValidatorConstraint({ name: 'IsOklchColor', async: false })
export class IsOklchColorConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && OKLCH_PATTERN.test(value);
  }

  defaultMessage(): string {
    return 'must be an oklch() color, e.g. oklch(0.48 0.13 165)';
  }
}

/**
 * Rejects any colour that is not an `oklch()` string. Applied to every palette
 * field so a hallucinated hex or named colour never reaches the database.
 */
export function IsOklchColor(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsOklchColorConstraint,
    });
  };
}
