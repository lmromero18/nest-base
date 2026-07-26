import { IsNotEmpty, IsString } from 'class-validator';
import { RESPONSE_MESSAGES } from '../../../common/constants/response-messages';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: RESPONSE_MESSAGES.AUTH.LOGIN.USERNAME_REQUIRED })
  username!: string;

  @IsString()
  @IsNotEmpty({ message: RESPONSE_MESSAGES.AUTH.LOGIN.PASSWORD_REQUIRED })
  password!: string;
}
