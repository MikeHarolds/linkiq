import { registerDecorator, type ValidationOptions } from 'class-validator';

import { validateUtmValue } from './utm';

/** DTO-level wrapper around validateUtmValue (length, control characters, disallowed content). */
export function IsValidUtmValue(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isValidUtmValue',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return validateUtmValue(value).valid;
        },
        defaultMessage() {
          return 'must be a valid UTM value (1-255 characters, no control characters or disallowed content)';
        },
      },
    });
  };
}
