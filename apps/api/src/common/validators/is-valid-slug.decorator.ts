import { registerDecorator, type ValidationOptions } from 'class-validator';

import { validateCustomSlug } from '../utils/short-code';

/** DTO-level wrapper around validateCustomSlug (charset, length, reserved words). */
export function IsValidSlug(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isValidSlug',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return validateCustomSlug(value).valid;
        },
        defaultMessage() {
          return 'slug must be 3-50 characters, contain only letters/numbers/hyphens/underscores, and not be a reserved word';
        },
      },
    });
  };
}
