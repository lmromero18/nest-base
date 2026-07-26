import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { NotificationType } from '../notification.types';

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsNotEmpty()
  destination!: string;

  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;
}
