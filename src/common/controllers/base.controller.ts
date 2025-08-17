import {
  Body,
  Delete,
  Get,
  HttpException, HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query
} from '@nestjs/common';
import { DeepPartial, ObjectLiteral } from 'typeorm';
import { BaseService } from '../services/base.service';

export class BaseController<T extends ObjectLiteral> {
  constructor(protected readonly service: BaseService<T>) { }

  @Get()
  async find(@Query() query: any) {
    const { page = 1, limit = 10, ...filters } = query;
    return this.service.find(Number(page), Number(limit), filters);
  }

  @Get(':id')
  async findOne(@Param('id') id: number) {
    try {
      return await this.service.findOne(id);
    } catch {
      throw new NotFoundException('Recurso no encontrado');
    }
  }

  @Post()
  async create(@Body() data: DeepPartial<T>) {
    try {
      return await this.service.create(data);
    } catch (e) {
      throw new HttpException(
        { status: 'error', message: 'Error al crear', error: e.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id')
  async update(@Param('id') id: number, @Body() data: Partial<T>) {
    try {
      return await this.service.update(id, data);
    } catch (e) {
      throw new HttpException(
        { status: 'error', message: 'Error al actualizar', error: e.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async softRemove(@Param('id') id: number) {
    try {
      await this.service.softDelete(id);
      return { status: 'success', message: 'Eliminado correctamente' };
    } catch (e) {
      throw new HttpException(
        { status: 'error', message: 'Error al eliminar', error: e.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  @Delete('delete/:id')
  async hardRemove(@Param('id') id: number) {
    try {
      await this.service.remove(id);
      return { status: 'success', message: 'Eliminado correctamente' };
    } catch (e) {
      throw new HttpException(
        { status: 'error', message: 'Error al eliminar', error: e.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
