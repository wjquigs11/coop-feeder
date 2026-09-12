// Minimal ambient types for react-native-zeroconf (0.14.0), which ships no
// TypeScript declarations. Covers only the API this app uses.
declare module 'react-native-zeroconf' {
  export interface Service {
    name?: string;
    fullName?: string;
    host?: string;
    port?: number;
    addresses?: string[];
    txt?: Record<string, unknown>;
  }

  export type ZeroconfEvent =
    | 'start'
    | 'stop'
    | 'found'
    | 'resolved'
    | 'remove'
    | 'update'
    | 'error'
    | 'published'
    | 'unpublished';

  export enum ImplType {
    NSD = 'NSD',
    DNSSD = 'DNSSD',
  }

  export default class Zeroconf {
    constructor();
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void;
    stop(implType?: string): void;
    getServices(): Record<string, Service>;
    publishService(
      type: string,
      protocol: string,
      domain: string,
      name: string,
      port: number,
      txt?: Record<string, unknown>,
      implType?: string,
    ): void;
    unpublishService(name: string, implType?: string): void;
    addDeviceListeners(): void;
    removeDeviceListeners(): void;
    on(event: 'resolved', listener: (service: Service) => void): void;
    on(event: 'found' | 'remove', listener: (name: string) => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
    on(event: ZeroconfEvent, listener: (...args: unknown[]) => void): void;
    removeAllListeners?(event?: ZeroconfEvent): void;
  }
}
