// Contratos tipados del feature de notificaciones

export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}
