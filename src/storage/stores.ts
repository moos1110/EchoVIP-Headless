import path from 'node:path';
import { config } from '../config.js';
import type { AuthState, DeviceIdentity, TaskState } from '../types.js';
import { JsonStore } from './json-store.js';

export const authStore = new JsonStore<AuthState>(path.join(config.dataDir, 'auth.json'));
export const deviceStore = new JsonStore<DeviceIdentity>(path.join(config.dataDir, 'device.json'));
export const stateStore = new JsonStore<TaskState>(path.join(config.dataDir, 'state.json'));

