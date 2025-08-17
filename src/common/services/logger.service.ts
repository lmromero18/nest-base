import { ConsoleLogger, Injectable, OnModuleInit } from '@nestjs/common';
import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { getEnv } from '../utils/env';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import * as zlib from 'zlib';

@Injectable()
export class Logger extends ConsoleLogger implements OnModuleInit {
    private readonly logger: winston.Logger;

    constructor() {
        super();

        const zipEnabled = getEnv('APP_LOG_ZIP', 'false') === 'true';

        const logDir = path.join(process.cwd(), getEnv('APP_LOG_DIR'));
        const auditDir = path.join(process.cwd(), getEnv('APP_AUDIT_DIR'));
        const zipDir = path.join(process.cwd(), getEnv('APP_ZIP_DIR'));

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        if (!fs.existsSync(zipDir) && zipEnabled) {
            fs.mkdirSync(zipDir, { recursive: true });
        }

        if (!fs.existsSync(auditDir)) {
            fs.mkdirSync(auditDir, { recursive: true });
        }

        const excludeErrors = winston.format((info) => {
            return info.level !== 'error' ? info : false;
        });

        this.logger = winston.createLogger({
            level: getEnv('LOG_LEVEL', 'info'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.printf(({ timestamp, level, message, stack }) =>
                    `[${timestamp}] ${level.toUpperCase()}: ${stack || message}`
                )
            ),
            transports: [
                new winston.transports.File({
                    filename: path.join(logDir, 'error.log'),
                    level: 'error',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.errors({ stack: true }),
                    ),
                }),
                new winston.transports.File({
                    filename: path.join(logDir, 'info.log'),
                    level: 'silly',
                    format: winston.format.combine(
                        excludeErrors(),
                        winston.format.timestamp(),
                        winston.format.errors({ stack: true }),
                        winston.format.printf(({ timestamp, level, message, stack }) =>
                            `[${timestamp}] ${level.toUpperCase()}: ${stack || message}`
                        )
                    )
                }),
            ],
        });

    }



    onModuleInit() {
        this.watchAllLogs('info');
        this.watchAllLogs('error');
    }

    private watchAllLogs(type: 'info' | 'error') {
        const zipEnabled = getEnv('APP_LOG_ZIP', 'false') === 'true';
        if (!zipEnabled) return;

        const logDir = path.join(process.cwd(), getEnv('APP_LOG_DIR'));
        const file = path.join(logDir, `${type}.log`);
        const maxSize = this.parseSize(getEnv('APP_LOG_MAX_SIZE', '10m'));

        fs.watchFile(file, (curr) => {
            if (curr.size >= maxSize) {
                this.compressAndRotate(file, type);
            }
        });
    }


    private compressAndRotate(file: string, type: 'info' | 'error') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const auditDir = path.join(process.cwd(), getEnv('APP_ZIP_DIR'));
        const outputFile = path.join(auditDir, `${type}-${timestamp}.gz`);

        const gzip = zlib.createGzip();
        const input = fs.createReadStream(file);
        const output = fs.createWriteStream(outputFile);

        input.pipe(gzip).pipe(output).on('close', () => {
            setTimeout(() => {
                try {
                    fs.truncateSync(file, 0);
                    this.log(`[LOG ROTATE] ${type}.log comprimido como ${outputFile}`);
                } catch (err) {
                    this.error(`Error al limpiar el archivo: ${file}`, err);
                }
            }, 100);
        });
    }

    private parseSize(size: string): number {
        const match = size.toLowerCase().match(/(\d+)([kmg]?)/);
        if (!match) {
            throw new Error(`Invalid size format: ${size}`);
        }
        const num = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
            case 'k': return num * 1024;
            case 'm': return num * 1024 * 1024;
            case 'g': return num * 1024 * 1024 * 1024;
            default: return num;
        }
    }

    private currentDate(): string {
        return new Date().toISOString().slice(0, 10);
    }

    info(message: any, context?: string, ...optionalParams: any[]) {
        super.log(message, context, ...optionalParams);
        this.logger.info(this.format(message, context, optionalParams));
    }

    error(message: any, trace?: string, context?: string, ...optionalParams: any[]) {
        super.error(message, trace, context, ...optionalParams);
        this.logger.error(this.format(message, context, [trace, ...optionalParams]));
    }

    warn(message: any, context?: string, ...optionalParams: any[]) {
        super.warn(message, context, ...optionalParams);
        this.logger.warn(this.format(message, context, optionalParams));
    }

    debug(message: any, context?: string, ...optionalParams: any[]) {
        super.debug(message, context, ...optionalParams);
        this.logger.debug(this.format(message, context, optionalParams));
    }

    verbose(message: any, context?: string, ...optionalParams: any[]) {
        super.verbose(message, context, ...optionalParams);
        this.logger.verbose(this.format(message, context, optionalParams));
    }

    private format(message: any, context?: string, optionalParams: any[] = []): string {
        const rest = optionalParams.map((v) =>
            typeof v === 'string' ? v : JSON.stringify(v)
        );
        return `[${context ?? 'App'}] ${[message, ...rest].join(' ')}`;
    }

}
