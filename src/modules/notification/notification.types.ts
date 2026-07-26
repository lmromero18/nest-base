// Strongly-typed contracts for the Notification feature

export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export interface NotificationCreateContext {
  clientId?: string | number | null;
  userId?: string | number | null;
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
