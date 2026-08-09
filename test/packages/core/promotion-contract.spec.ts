import { describe, expect, it } from 'bun:test';
import { CrudControllerFactory } from '../../../src/common/controller/crud-controller.factory';
import { BaseService } from '../../../src/common/services/base.service';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('bounded adapter compatibility contract', () => {
  it('receives the isolated promotion package workspace explicitly', () => {
    const packageRoot = process.env.NEST_BASE_CORE_PACKAGE_ROOT;
    if (!packageRoot) return;
    expect(existsSync(resolve(packageRoot, 'package.json'))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
    ) as { name?: string };
    expect(manifest.name).toBe('@nest-base/core');
  });

  it('keeps the compatibility adapter constructible with the core service contract', () => {
    const ControllerBase = CrudControllerFactory<{ id: number }>({
      routes: [],
    });
    class Controller extends ControllerBase {}
    const service = {} as BaseService<{ id: number }>;
    const controller = new Controller(service);

    expect(controller).toBeInstanceOf(Controller);
    expect(controller['service']).toBe(service);
  });

  it('retains the find boundary required by the compatibility contract', () => {
    const ControllerBase = CrudControllerFactory<{ id: number }>({
      routes: [],
    });
    class Controller extends ControllerBase {}

    expect(() => new Controller(undefined as never)).not.toThrow();
    expect(typeof Controller.prototype.find).toBe('function');
  });
});
