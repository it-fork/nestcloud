import { OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import * as md5encode from 'blueimp-md5';
import * as Consul from 'consul';
import { get } from 'lodash';

import { IService, sleep, IServiceNode } from '@nestcloud/common';
import { IServiceOptions } from './interfaces/service-options.interface';
import { IServiceCheck } from './interfaces/service-check.interface';
import { getIPAddress } from './utils/os.util';
import { ConsulStore } from './consul-store';

export class ConsulService implements OnModuleInit, OnModuleDestroy, IService {
    private store: ConsulStore;
    private readonly logger = new Logger('ServiceModule');

    private readonly discoveryHost: string;
    private readonly serviceId: string;
    private readonly serviceName: string;
    private readonly servicePort: number;
    private readonly serviceTags: string[];
    private readonly timeout: string;
    private readonly deregisterCriticalServiceAfter: string;
    private readonly interval: string;
    private readonly maxRetry: number;
    private readonly retryInterval: number;
    private readonly protocol: string;
    private readonly route: string;
    private readonly tcp: string;
    private readonly script: string;
    private readonly dockerContainerId: string;
    private readonly shell: string;
    private readonly ttl: string;
    private readonly notes: string;
    private readonly status: string;
    private readonly includes: string[];

    constructor(
        private readonly consul: Consul,
        options: IServiceOptions,
    ) {
        this.discoveryHost = get(options, 'discoveryHost', getIPAddress());
        this.serviceId = get(options, 'id');
        this.serviceName = get(options, 'name');
        // tslint:disable-next-line:no-bitwise
        this.servicePort = get(options, 'port', 40000 + ~~(Math.random() * (40000 - 30000)));
        this.serviceTags = get(options, 'tags');
        this.timeout = get(options, 'healthCheck.timeout', '1s');
        this.interval = get(options, 'healthCheck.interval', '10s');
        this.deregisterCriticalServiceAfter = get(options, 'healthCheck.deregisterCriticalServiceAfter');
        this.maxRetry = get(options, 'maxRetry', 5);
        this.retryInterval = get(options, 'retryInterval', 5000);
        this.protocol = get(options, 'healthCheck.protocol', 'http');
        this.route = get(options, 'healthCheck.route', '/health');
        this.tcp = get(options, 'healthCheck.tcp');
        this.script = get(options, 'healthCheck.script');
        this.dockerContainerId = get(options, 'healthCheck.dockerContainerId');
        this.shell = get(options, 'healthCheck.shell');
        this.ttl = get(options, 'healthCheck.ttl');
        this.notes = get(options, 'healthCheck.notes');
        this.status = get(options, 'healthCheck.status');
        this.includes = get(options, 'service.includes', []);
    }

    async init() {
        this.store = new ConsulStore(this.consul, this.includes);
        while (true) {
            try {
                await this.store.init();
                this.logger.log('ServiceModule initialized');
                break;
            } catch (e) {
                this.logger.error(`Unable to initial ServiceModule, retrying...`, e);
                await sleep(this.retryInterval);
            }
        }
    }

    watch(service: string, callback: (services: IServiceNode[]) => void) {
        this.store.watch(service, callback);
    }

    watchServiceList(callback: (service: string[]) => void) {
        this.store.watchServiceList(callback);
    }

    getServices(): { [service: string]: IServiceNode[] } {
        return this.store.getServices();
    }

    getServiceNames(): string[] {
        return this.store.getServiceNames();
    }

    getServiceNodes(service: string, passing?: boolean): IServiceNode[] {
        return this.store.getServiceNodes(service, passing);
    }

    async onModuleInit(): Promise<any> {
        await this.registerService();
    }

    async onModuleDestroy(): Promise<any> {
        await this.cancelService();
    }

    private generateService() {
        const check = {
            interval: this.interval,
            timeout: this.timeout,
            deregistercriticalserviceafter: this.deregisterCriticalServiceAfter,
            notes: this.notes,
            status: this.status,
        } as IServiceCheck;

        if (this.tcp) {
            check.tcp = this.tcp;
        } else if (this.script) {
            check.script = this.script;
        } else if (this.dockerContainerId) {
            check.dockercontainerid = this.dockerContainerId;
            check.shell = this.shell;
        } else if (this.ttl) {
            check.ttl = this.ttl;
        } else {
            check.http = `${this.protocol}://${this.discoveryHost}:${this.servicePort}${this.route}`;
        }

        return {
            id: this.serviceId || md5encode(`${this.discoveryHost}:${this.servicePort}`),
            name: this.serviceName,
            address: this.discoveryHost,
            port: parseInt(this.servicePort + ''),
            tags: this.serviceTags,
            check,
        };
    }

    private async registerService() {
        const service = this.generateService();

        while (true) {
            try {
                await this.consul.agent.service.register(service);
                this.logger.log(`Register service ${service.name} success.`);
                break;
            } catch (e) {
                this.logger.warn(`Register service ${service.name} fail, retrying...`, e);
                await sleep(this.retryInterval);
            }
        }
    }

    private async cancelService() {
        const service = this.generateService();

        let current = 0;
        while (true) {
            try {
                await this.consul.agent.service.deregister(service);
                this.logger.log(`Deregister service ${service.name} success.`);
                break;
            } catch (e) {
                if (this.maxRetry !== -1 && ++current > this.maxRetry) {
                    this.logger.error(`Deregister service ${service.name} fail`, e);
                    break;
                }

                this.logger.warn(`Deregister service ${service.name} fail, retrying...`, e);
                await sleep(this.retryInterval);
            }
        }
    }
}