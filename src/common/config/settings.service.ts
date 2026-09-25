import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from './environment';

@Injectable()
export class Settings {
  constructor(private readonly config: ConfigService<Environment, true>) {}
  get<K extends keyof Environment>(key: K): Environment[K] {
    return this.config.get(key, { infer: true });
  }
}
