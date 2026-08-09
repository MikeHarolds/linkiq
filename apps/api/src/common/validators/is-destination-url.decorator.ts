import { registerDecorator, type ValidationOptions } from 'class-validator';

import { validateDestinationUrl } from '../utils/url-validator';

/** DTO-level wrapper around validateDestinationUrl (see that function for the actual rules). */
export function IsDestinationUrl(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isDestinationUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return validateDestinationUrl(value).valid;
        },
        defaultMessage() {
          return 'destinationUrl must be a valid, absolute http:// or https:// URL';
        },
      },
    });
  };
}
