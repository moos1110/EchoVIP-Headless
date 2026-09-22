import { authStore } from '../storage/stores.js';

export const logoutCommand = async (): Promise<void> => {
  await authStore.delete();
  console.log('✅ 已清除登录态；设备身份仍保留');
};

