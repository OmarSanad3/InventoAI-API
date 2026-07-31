import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@ValidatorConstraint({ name: 'IsSlug', async: false })
export class IsSlugConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && SLUG_PATTERN.test(value);
  }

  defaultMessage(): string {
    return 'must contain only lowercase letters, numbers and single hyphens';
  }
}

/**
 * Accepts a URL-safe slug: lowercase alphanumerics separated by single hyphens,
 * with no leading or trailing hyphen. Length is not checked here — pair it with
 * `@Length()`.
 */
export function IsSlug(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      constraints: [],
      validator: IsSlugConstraint,
    });
  };
}
