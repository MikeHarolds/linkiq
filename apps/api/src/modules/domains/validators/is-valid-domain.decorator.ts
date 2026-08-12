import { registerDecorator, type ValidationOptions } from 'class-validator';

import { validateDomainFormat } from '../utils/domain-normalization';

/** DTO-level wrapper around validateDomainFormat (charset, label rules, length). */
export function IsValidDomain(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isValidDomain',
      target: object.constructor,
      propertyName: propertyName as string,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          return validateDomainFormat(value).valid;
        },
        defaultMessage() {
          return 'domain must be a valid hostname (e.g. go.example.com)';
        },
      },
    });
  };
}
