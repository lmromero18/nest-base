import {
  Body,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeepPartial, ObjectLiteral } from 'typeorm';
import { BaseService } from '../services/base.service';

export class BaseController<T extends ObjectLiteral> {
  constructor(protected readonly service: BaseService<T>) {}

  @Get()
  async find(@Query() query: any) {
    const { page = 1, limit = 10, ...filters } = query;
    return this.service.find(Number(page), Number(limit), filters);
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    const entity = await this.service.findOne(id);
    if (!entity) {
      throw new NotFoundException('Recurso no encontrado');
    }
    return entity;
  }

  @Post()
  async create(@Body() data: DeepPartial<T>) {
    try {
      return await this.service.create(data);
    } catch (e) {
      throw new UnprocessableEntityException('Error al crear');
    }
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() data: Partial<T>) {
    try {
      const updatedEntity = await this.service.update(id, data);
      if (!updatedEntity) {
        throw new NotFoundException('Recurso no encontrado');
      } else {
        return updatedEntity;
      }
    } catch (e) {
      throw new UnprocessableEntityException('Error al actualizar');
    }
  }

  @Delete(':id')
  async softRemove(@Param('id') id: number) {
    try {
      await this.service.softDelete(id);
      return { status: 'success', message: 'Eliminado correctamente' };
    } catch (e) {
      throw new UnprocessableEntityException('Error al eliminar');
    }
  }

  @Delete('delete/:id')
  async hardRemove(@Param('id') id: number) {
    try {
      await this.service.remove(id);
      return { status: 'success', message: 'Eliminado correctamente' };
    } catch (e) {
      throw new UnprocessableEntityException('Error al eliminar');
    }
  }
}
