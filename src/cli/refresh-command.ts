import type { createAppContext } from '../app-context.js';
import { maskUserId } from '../utils/mask.js';

type Context = ReturnType<typeof createAppContext>;

export const refreshCommand = async (app: Context): Promise<void> => {
  const device = await app.device.ensure();
  const auth = await app.refresh.refresh(device);
  console.log(`✅ Token 刷新成功，用户：${maskUserId(auth.userid)}`);
};

