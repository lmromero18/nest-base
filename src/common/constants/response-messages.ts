export const RESPONSE_MESSAGES = {
  AUTH: {
    LOGIN: {
      USERNAME_REQUIRED: 'El campo username es requerido',
      PASSWORD_REQUIRED: 'El campo password es requerido',
      CONFIG_MISSING:
        'Falta configuracion de AUTH_API_URL, CENSO_CLIENT_ID o CENSO_CLIENT_SECRET',
      PROCESS_ERROR: 'Error durante el proceso de autenticacion',
    },
    TOKEN: {
      MISSING:
        'La sesion es invalida o ha expirado, por favor inicie sesion nuevamente',
      INVALID:
        'La sesion es invalida o ha expirado, por favor inicie sesion nuevamente',
      EXPIRED:
        'La sesion es invalida o ha expirado, por favor inicie sesion nuevamente',
      CONFIG_MISSING:
        'Falta configurar JWT_PUBLIC_KEY para validar el token JWT',
    },
  },
  GENERAL: {
    ERROR_DESCONOCIDO: 'Error desconocido durante el registro',
    NO_ENCONTRADO: 'Recurso no encontrado',
    CREAR_ERROR: 'Error creando el recurso',
    ACTUALIZAR_ERROR: 'Error al actualizar',
    ELIMINAR_ERROR: 'Error al eliminar',
    ELIMINADO_EXITO: 'Eliminado correctamente',
  },
  BRIGADISTA: {
    CEDULA_DUPLICADA: 'Ya existe un brigadista con esa cédula de identidad',
    CORREO_DUPLICADO: 'Ya existe un brigadista con ese correo electrónico',
  },
} as const;
