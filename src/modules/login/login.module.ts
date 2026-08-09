import { Module } from '@nestjs/common';
import { HttpClientModule } from '../../common/http/http-client.module';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';

@Module({
  imports: [HttpClientModule],
  controllers: [LoginController],
  providers: [LoginService],
})
export class LoginModule {}
