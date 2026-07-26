import {
  Body,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeepPartial, ObjectLiteral } from 'typeorm';
import { BaseService } from '../services/base.service';
import { successResponse } from '../responses/success.response';
import { Logger } from '@nestjs/common';
import { handleErrorWrapper } from '../utils/error.util';

export class BaseController<
  T extends ObjectLiteral,
  CreateDto extends DeepPartial<T> = DeepPartial<T>,
> {
  protected readonly logger = new Logger(BaseController.name);
  constructor(protected readonly service: BaseService<T>) {}

  @Get()
  async find(@Query() query: any) {
    const { page = 1, limit = 20, ...filters } = query;
    return this.service.find(Number(page), Number(limit), filters);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Query() query: any) {
    const filters = { with: query?.with };
    const entity = await this.service.findOne(id, filters);
    if (!entity) {
      throw new NotFoundException('Recurso no encontrado');
    }
    return entity;
  }

  @Post()
  async create(@Body() data: CreateDto) {
    try {
      return await this.service.create(data);
    } catch (e) {
      this.handleError(e, 'Error creando el recurso');
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: Partial<T>) {
    try {
      const updatedEntity = await this.service.updateByPk(id, data);
      if (!updatedEntity) throw new NotFoundException('Recurso no encontrado');
      return updatedEntity;
    } catch (e) {
      this.handleError(e, 'Error al actualizar');
    }
  }

  @Delete(':id')
  async softRemove(@Param('id') id: string) {
    try {
      const result = await this.service.softDeleteByPk(id);
      return successResponse('Eliminado correctamente');
    } catch (e) {
      this.handleError(e, 'Error al eliminar');
    }
  }

  @Delete('delete/:id')
  async hardRemove(@Param('id') id: string) {
    try {
      const deleted = await this.service.removeByPk(id);
      if (!deleted) throw new NotFoundException('Recurso no encontrado');
      return successResponse('Eliminado correctamente');
    } catch (e) {
      this.handleError(e, 'Error al eliminar');
    }
  }

  // Expose a common error handler for child controllers
  protected handleError(e: any, defaultMessage: string): never {
    return handleErrorWrapper(e, defaultMessage, this.logger);
  }
}
