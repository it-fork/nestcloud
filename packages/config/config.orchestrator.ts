import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigStore } from './config.store';
import { ConfigValueMetadata } from './interfaces/config-value-metadata.interface';

interface ConfigValue {
    name: string;
    property: string;
    target: Function;
    defaults: any;
}

@Injectable()
export class ConfigOrchestrator implements OnApplicationBootstrap {
    private readonly configValues = new Map<string, ConfigValue>();

    constructor(
        private readonly store: ConfigStore,
    ) {
    }

    public addConfigValues(target: Function, configValues: ConfigValueMetadata[]) {
        configValues.forEach(({ name, defaults, property }) => {
            const key = `${name}__${property}__${target.constructor.name}`;
            this.configValues.set(key, { name, property, target, defaults });
        });
    }

    async onApplicationBootstrap(): Promise<void> {
        await this.mountConfigValues();
    }

    private async mountConfigValues() {
        for (const item of this.configValues.values()) {
            const { name, property, target, defaults } = item;
            const path = name || property;

            this.store.watch(path, value => {
                if (value !== void 0) {
                    target[property] = value;
                } else if (defaults !== void 0) {
                    target[property] = value;
                }
            });
            const value = this.store.get(path, defaults);
            if (value !== void 0) {
                target[property] = value;
            }
        }
    }
}
