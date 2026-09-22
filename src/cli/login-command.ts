import { authStore, stateStore } from '../storage/stores.js';
import { maskUserId } from '../utils/mask.js';
import type { createAppContext } from '../app-context.js';

type Context = ReturnType<typeof createAppContext>;

export const loginCommand = async (app: Context, force: boolean): Promise<void> => {
  const existing = await authStore.read();
  if (existing && !force) {
    await app.auth.ensureValid(await app.device.ensure());
    console.log(`✅ 当前已经登录：${maskUserId(existing.userid)}（如需重登请使用 login --force）`);
    return;
  }
  const device = await app.device.ensure();
  const auth = await app.login.login(device, force);
  await app.auth.ensureValid(device);
  await stateStore.delete();
  console.log(`✅ 登录成功，用户：${maskUserId(auth.userid)}`);
};
