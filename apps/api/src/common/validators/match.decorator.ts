import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Validates that this field's value equals the value of another field on
 * the same object — e.g. passwordConfirmation === password.
 */
export function Match(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'match',
      target: object.constructor,
      propertyName: propertyName as string,
      options: {
        message: `${String(propertyName)} must match ${property}`,
        ...validationOptions,
      },
      constraints: [property],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];
          return value === relatedValue;
        },
      },
    });
  };
}
