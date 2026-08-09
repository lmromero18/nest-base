import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { NotificationType } from '../notification.types';

// Importar SIEMPRE los DTOs de @Body como valor (nunca `import type`):
// con `import type` la clase se elide del JS y la validación jamás corre.
export class CreateNotificationDto {
  @ApiProperty({ example: 'Bienvenido al sistema', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject!: string;

  @ApiProperty({ description: 'Cuerpo del mensaje (HTML permitido en EMAIL)' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({
    example: 'usuario@dominio.com',
    description: 'Destino: email, teléfono o token según el tipo',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  destination!: string;

  @ApiProperty({ enum: NotificationType, example: NotificationType.EMAIL })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiPropertyOptional({
    description:
      'Fecha programada de envío en ISO 8601; omitir para envío inmediato',
    example: '2026-08-01T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  tsScheduledAt?: string;
}
