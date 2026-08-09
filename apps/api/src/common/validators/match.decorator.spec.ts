import { validate } from 'class-validator';

import { Match } from './match.decorator';

class TestDto {
  password!: string;

  @Match('password')
  passwordConfirmation!: string;
}

describe('@Match', () => {
  it('passes validation when both fields are equal', async () => {
    const dto = new TestDto();
    dto.password = 'SecurePass123';
    dto.passwordConfirmation = 'SecurePass123';

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails validation when the fields differ', async () => {
    const dto = new TestDto();
    dto.password = 'SecurePass123';
    dto.passwordConfirmation = 'SomethingElse456';

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error?.property).toBe('passwordConfirmation');
    expect(error?.constraints?.match).toContain(
      'passwordConfirmation must match password',
    );
  });

  it('fails validation when the confirmation is empty', async () => {
    const dto = new TestDto();
    dto.password = 'SecurePass123';
    dto.passwordConfirmation = '';

    const errors = await validate(dto);
    expect(errors).toHaveLength(1);
  });
});
