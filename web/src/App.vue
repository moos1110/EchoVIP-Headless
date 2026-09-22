<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

interface Schedule {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
}

interface Account {
  id: string;
  name: string;
  maskedUserId: string | null;
  loggedIn: boolean;
  schedule: Schedule;
  pendingSchedule?: { effectiveDate: string; value: Schedule };
  today: { date: string; status: string | null; at: string | null; error: string | null };
  plannedAt: string | null;
}

interface LoginJob {
  state: string;
  qrReady: boolean;
  message: string;
}

interface Operation {
  id: string;
  source: 'manual' | 'automatic' | 'system';
  action: string;
  status: 'planned' | 'running' | 'success' | 'failed' | 'blocked' | 'cancelled' | 'info';
  title: string;
  message: string;
  occurredAt: string;
  exitCode?: number;
}

type ConfirmKind = 'relogin' | 'logout' | 'delete';
interface ConfirmDialog { kind: ConfirmKind; account: Account; title: string; message: string; confirmLabel: string }

const authenticated = ref(false);
const password = ref('');
const csrfToken = ref('');
const loginError = ref('');
const busy = ref(false);
const workingId = ref('');
const mode = ref<'provisioning' | 'server'>('provisioning');
const configuredDomain = ref('');
const accounts = ref<Account[]>([]);
const newName = ref('');
const notice = ref('');
const errorMessage = ref('');
const qrAccount = ref<Account | null>(null);
const loginJob = ref<LoginJob | null>(null);
const selectedAccountId = ref('');
const operations = ref<Operation[]>([]);
const rawLines = ref<string[]>([]);
const logFilter = ref<'all' | 'manual' | 'automatic' | 'system'>('all');
const logLoading = ref(false);
const confirmDialog = ref<ConfirmDialog | null>(null);
const deletePhrase = ref('');
let loginPollTimer: number | null = null;
let dashboardTimer: number | null = null;

const provisioning = computed(() => mode.value === 'provisioning');
const selectedAccount = computed(() => accounts.value.find((item) => item.id === selectedAccountId.value) ?? null);
const filteredOperations = computed(() => logFilter.value === 'all'
  ? operations.value
  : operations.value.filter((item) => item.source === logFilter.value));
const canConfirm = computed(() => confirmDialog.value?.kind !== 'delete'
  || deletePhrase.value.trim() === confirmDialog.value.account.name);

const api = async <T>(url: string, options: RequestInit = {}, mutation = false): Promise<T> => {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (mutation && csrfToken.value) headers.set('X-CSRF-Token', csrfToken.value);
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data as T;
};

const bootstrap = async (): Promise<void> => {
  const session = await api<{ authenticated: boolean; csrfToken?: string }>('/api/session/me');
  authenticated.value = session.authenticated;
  csrfToken.value = session.csrfToken ?? '';
  if (authenticated.value) await loadDashboard();
};

const signIn = async (): Promise<void> => {
  loginError.value = '';
  busy.value = true;
  try {
    const result = await api<{ csrfToken: string }>('/api/session/login', {
      method: 'POST', body: JSON.stringify({ password: password.value }),
    });
    csrfToken.value = result.csrfToken;
    authenticated.value = true;
    password.value = '';
    await loadDashboard();
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
};

const signOut = async (): Promise<void> => {
  await api('/api/session/logout', { method: 'POST' }, true);
  authenticated.value = false;
  csrfToken.value = '';
  accounts.value = [];
  operations.value = [];
};

const loadDashboard = async (): Promise<void> => {
  const [capabilities, result] = await Promise.all([
    api<{ mode: 'provisioning' | 'server'; panelDomain?: string }>('/api/system/capabilities'),
    api<{ accounts: Account[] }>('/api/accounts'),
  ]);
  mode.value = capabilities.mode;
  configuredDomain.value = capabilities.panelDomain ?? '';
  accounts.value = result.accounts;
  if (!accounts.value.some((item) => item.id === selectedAccountId.value)) {
    selectedAccountId.value = accounts.value[0]?.id ?? '';
  }
};

const loadLogs = async (quiet = false): Promise<void> => {
  if (!selectedAccountId.value || !authenticated.value) {
    operations.value = [];
    rawLines.value = [];
    return;
  }
  if (!quiet) logLoading.value = true;
  try {
    const result = await api<{ operations: Operation[]; lines: string[] }>(`/api/accounts/${selectedAccountId.value}/logs`);
    operations.value = result.operations;
    rawLines.value = result.lines;
  } catch (error) {
    if (!quiet) showError(error);
  } finally { logLoading.value = false; }
};

const selectAccount = (id: string): void => { selectedAccountId.value = id; };

const addAccount = async (): Promise<void> => {
  busy.value = true;
  try {
    const result = await api<{ account: Account }>('/api/accounts', {
      method: 'POST', body: JSON.stringify({ name: newName.value.trim() || `账号 ${accounts.value.length + 1}` }),
    }, true);
    newName.value = '';
    await loadDashboard();
    selectAccount(result.account.id);
    await startLogin(result.account);
  } catch (error) { showError(error); }
  finally { busy.value = false; }
};

const saveAccount = async (account: Account): Promise<void> => {
  workingId.value = account.id;
  try {
    await api(`/api/accounts/${account.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: account.name, schedule: account.schedule }),
    }, true);
    notice.value = provisioning.value ? '配置已保存；复制账号到服务器后才会执行。' : '配置已保存，签到设置从次日生效。';
    await loadDashboard();
    await loadLogs(true);
  } catch (error) { showError(error); }
  finally { workingId.value = ''; }
};

const toggleSchedule = (account: Account): void => { account.schedule.enabled = !account.schedule.enabled; };

const startLogin = async (account: Account): Promise<void> => {
  selectAccount(account.id);
  qrAccount.value = account;
  loginJob.value = { state: 'starting', qrReady: false, message: '正在生成二维码' };
  try {
    const result = await api<{ job: LoginJob }>(`/api/accounts/${account.id}/login/start`, { method: 'POST' }, true);
    loginJob.value = result.job;
    startLoginPolling(account.id);
    await loadLogs(true);
  } catch (error) { showError(error); closeQr(); }
};

const openConfirm = (account: Account, kind: ConfirmKind): void => {
  selectAccount(account.id);
  deletePhrase.value = '';
  const content: Record<ConfirmKind, Omit<ConfirmDialog, 'kind' | 'account'>> = {
    relogin: { title: '重新登录账号', message: '将清除当前认证信息并重新生成二维码；固定设备身份会保留，自动签到会停用。', confirmLabel: '退出并重新扫码' },
    logout: { title: '退出当前账号', message: '将删除认证信息并停用自动签到；固定设备身份与历史日志会保留。', confirmLabel: '确认退出登录' },
    delete: { title: '永久删除账号', message: '登录态、固定设备、签到状态和全部日志都将被删除，且无法恢复。', confirmLabel: '永久删除' },
  };
  confirmDialog.value = { kind, account, ...content[kind] };
};

const executeConfirm = async (): Promise<void> => {
  const dialog = confirmDialog.value;
  if (!dialog || !canConfirm.value) return;
  confirmDialog.value = null;
  workingId.value = dialog.account.id;
  try {
    if (dialog.kind === 'delete') {
      await api(`/api/accounts/${dialog.account.id}`, {
        method: 'DELETE', body: JSON.stringify({ confirmId: dialog.account.id }),
      }, true);
      notice.value = `“${dialog.account.name}”已永久删除。`;
      await loadDashboard();
      await loadLogs(true);
      return;
    }
    await api(`/api/accounts/${dialog.account.id}/logout`, { method: 'POST' }, true);
    await loadDashboard();
    await loadLogs(true);
    if (dialog.kind === 'relogin') {
      const current = accounts.value.find((item) => item.id === dialog.account.id);
      if (current) await startLogin(current);
    } else notice.value = `“${dialog.account.name}”已退出登录。`;
  } catch (error) { showError(error); }
  finally { workingId.value = ''; }
};

const runAction = async (account: Account, action: 'status' | 'claim'): Promise<void> => {
  workingId.value = account.id;
  selectAccount(account.id);
  try {
    const result = await api<{ result: { exitCode: number } }>(`/api/accounts/${account.id}/${action}`, { method: 'POST' }, true);
    notice.value = action === 'claim'
      ? (result.result.exitCode === 0 ? '手动签到已完成，详细结果已写入右侧日志。' : '手动签到未成功，请查看右侧日志。')
      : '状态刷新完成，详细结果已写入右侧日志。';
    await loadDashboard();
    await loadLogs();
  } catch (error) {
    showError(error);
    await loadLogs(true);
  } finally { workingId.value = ''; }
};

const startLoginPolling = (accountId: string): void => {
  stopLoginPolling();
  const poll = async (): Promise<void> => {
    try {
      const result = await api<{ job: LoginJob }>(`/api/accounts/${accountId}/login/status`);
      loginJob.value = result.job;
      if (['success', 'failed', 'cancelled', 'duplicate'].includes(result.job.state)) {
        stopLoginPolling();
        await loadDashboard();
        await loadLogs(true);
        if (result.job.state === 'success') window.setTimeout(closeQr, 1200);
      }
    } catch (error) { showError(error); stopLoginPolling(); }
  };
  void poll();
  loginPollTimer = window.setInterval(() => { void poll(); }, 1200);
};

const stopLoginPolling = (): void => {
  if (loginPollTimer !== null) window.clearInterval(loginPollTimer);
  loginPollTimer = null;
};

const cancelLogin = async (): Promise<void> => {
  if (!qrAccount.value) return;
  try {
    await api(`/api/accounts/${qrAccount.value.id}/login/cancel`, { method: 'POST' }, true);
    await loadLogs(true);
  } catch { /* 登录可能已经自然结束。 */ }
  closeQr();
};

const closeQr = (): void => {
  stopLoginPolling();
  qrAccount.value = null;
  loginJob.value = null;
};

const showError = (error: unknown): void => { errorMessage.value = error instanceof Error ? error.message : String(error); };

const statusLabel = (status: string): string => ({
  SUCCESS: '领取成功', ALREADY: '今日已领取', UNCONFIRMED: '等待复核', FAILED: '执行失败',
}[status] ?? status);
const sourceLabel = (source: Operation['source']): string => ({ manual: '手动', automatic: '自动', system: '系统' }[source]);
const operationStatusLabel = (status: Operation['status']): string => ({
  planned: '已计划', running: '执行中', success: '成功', failed: '失败', blocked: '已暂停', cancelled: '已取消', info: '已记录',
}[status]);
const formatLogTime = (value: string): string => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date(value));

watch(selectedAccountId, () => { void loadLogs(); });
onMounted(() => {
  void bootstrap().catch(showError);
  dashboardTimer = window.setInterval(() => {
    if (!authenticated.value) return;
    void loadDashboard().then(() => loadLogs(true)).catch(() => undefined);
  }, 10_000);
});
onBeforeUnmount(() => {
  stopLoginPolling();
  if (dashboardTimer !== null) window.clearInterval(dashboardTimer);
});
</script>

<template>
  <main v-if="!authenticated" class="login-shell">
    <section class="login-card">
      <div class="brand-lockup"><div class="brand-mark">E</div><span>ECHOVIP</span></div>
      <p class="eyebrow">ACCOUNT CONTROL CENTER</p>
      <h1>账号管理中心</h1>
      <p class="muted">统一管理酷狗概念版账号、签到计划和运行记录。</p>
      <form @submit.prevent="signIn">
        <label>面板密码<input v-model="password" type="password" autocomplete="current-password" minlength="8" required placeholder="输入面板密码" /></label>
        <p v-if="loginError" class="form-error">{{ loginError }}</p>
        <button class="button primary full" :disabled="busy">{{ busy ? '验证中…' : '进入面板' }}</button>
      </form>
      <p class="security-note">密码仅用于当前面板，不是服务器或酷狗密码。</p>
    </section>
  </main>

  <main v-else class="app-shell">
    <header class="topbar">
      <div class="brand-lockup"><div class="brand-mark small">E</div><div><p class="eyebrow">ECHOVIP</p><h1>账号与签到管理</h1></div></div>
      <div class="top-actions">
        <span class="mode-chip"><i></i>{{ provisioning ? '本地准备模式' : '服务器管理模式' }}</span>
        <span v-if="configuredDomain" class="domain-chip">{{ configuredDomain }}</span>
        <button class="button ghost" @click="signOut">退出面板</button>
      </div>
    </header>

    <section v-if="provisioning" class="mode-banner">
      <div class="banner-icon">i</div>
      <div><strong>当前只准备账号数据</strong><p>可以扫码登录并预设时间；本地不会查询、签到或启动调度，复制到服务器后再启用。</p></div>
    </section>
    <button v-if="notice" class="notice" @click="notice = ''"><span>{{ notice }}</span><b>×</b></button>

    <section class="create-bar">
      <div><h2>账号列表</h2><p>每个账号使用独立的认证、设备身份、签到状态和日志。</p></div>
      <form @submit.prevent="addAccount"><input v-model="newName" maxlength="40" placeholder="输入账号备注名称" /><button class="button primary" :disabled="busy">＋ 新增并扫码</button></form>
    </section>

    <section class="workspace-grid">
      <div class="accounts-column">
        <article v-for="account in accounts" :key="account.id" :class="['account-card', { selected: account.id === selectedAccountId }]" @click="selectAccount(account.id)">
          <div class="account-header">
            <div class="account-avatar">{{ account.name.slice(0, 1).toUpperCase() }}</div>
            <div class="account-title"><input v-model="account.name" class="name-input" maxlength="40" @click.stop /><p>{{ account.maskedUserId || '尚未绑定酷狗账号' }}</p></div>
            <span :class="['login-state', account.loggedIn ? 'online' : 'offline']"><i></i>{{ account.loggedIn ? '已登录' : '未登录' }}</span>
          </div>

          <div class="account-body">
            <div class="status-overview">
              <div><span>今日签到</span><strong>{{ account.today.status ? statusLabel(account.today.status) : (provisioning ? '本地不查询' : '暂无记录') }}</strong><small>{{ account.today.at || '—' }}</small></div>
              <div><span>今日自动计划</span><strong>{{ account.plannedAt || (account.schedule.enabled ? '等待生成' : '未启用') }}</strong><small>{{ account.schedule.timeZone }}</small></div>
            </div>

            <div class="schedule-panel">
              <div class="schedule-heading">
                <div><strong>每日自动签到</strong><span>{{ account.schedule.enabled ? '已启用' : '已停用' }}</span></div>
                <button type="button" :class="['switch', { active: account.schedule.enabled }]" role="switch" :aria-checked="account.schedule.enabled" @click.stop="toggleSchedule(account)"><span></span></button>
              </div>
              <div class="time-range">
                <label><span>开始时间</span><div class="time-input"><b>始</b><input v-model="account.schedule.start" inputmode="numeric" maxlength="8" placeholder="00:00:00" @click.stop /></div></label>
                <div class="range-arrow">→</div>
                <label><span>结束时间（不包含）</span><div class="time-input"><b>止</b><input v-model="account.schedule.end" inputmode="numeric" maxlength="8" placeholder="00:10:00" @click.stop /></div></label>
              </div>
              <p class="schedule-help">当天在该时间窗内随机选择一个秒级时间，全局串行执行。</p>
              <p v-if="account.pendingSchedule" class="pending">新设置将于 {{ account.pendingSchedule.effectiveDate }} 生效</p>
            </div>
          </div>

          <div class="account-footer">
            <div class="primary-actions">
              <button v-if="!account.loggedIn" class="button primary" @click.stop="startLogin(account)">扫码登录</button>
              <template v-else>
                <button class="button secondary" @click.stop="openConfirm(account, 'relogin')">重新登录</button>
                <button class="button secondary" @click.stop="openConfirm(account, 'logout')">退出登录</button>
              </template>
              <template v-if="!provisioning">
                <button class="button secondary" :disabled="!account.loggedIn || !!workingId" @click.stop="runAction(account, 'status')">刷新状态</button>
                <button class="button primary" :disabled="!account.loggedIn || !!workingId" @click.stop="runAction(account, 'claim')">手动签到</button>
              </template>
              <button class="button secondary save" :disabled="workingId === account.id" @click.stop="saveAccount(account)">{{ workingId === account.id ? '处理中…' : '保存设置' }}</button>
            </div>
            <button class="button danger-ghost" @click.stop="openConfirm(account, 'delete')">删除账号</button>
          </div>
        </article>

        <section v-if="!accounts.length" class="empty-state"><div>＋</div><h2>还没有账号</h2><p>输入账号备注并点击“新增并扫码”，二维码会在浏览器显示，同时写入对应账号目录。</p></section>
      </div>

      <aside class="log-panel">
        <div class="log-header">
          <div><p class="eyebrow">ACTIVITY</p><h2>运行日志</h2><span>{{ selectedAccount?.name || '未选择账号' }}</span></div>
          <button class="icon-button" :disabled="!selectedAccount || logLoading" title="刷新日志" @click="loadLogs()">↻</button>
        </div>
        <div class="log-filters">
          <button v-for="item in ([['all','全部'],['manual','手动'],['automatic','自动'],['system','系统']] as const)" :key="item[0]" :class="{ active: logFilter === item[0] }" @click="logFilter = item[0]">{{ item[1] }}</button>
        </div>
        <div v-if="logLoading && !operations.length" class="log-empty"><span class="spinner"></span><p>正在读取日志…</p></div>
        <div v-else-if="!selectedAccount" class="log-empty"><div class="empty-log-icon">◷</div><p>选择左侧账号后查看记录</p></div>
        <div v-else-if="!filteredOperations.length" class="log-empty"><div class="empty-log-icon">✓</div><p>该分类暂无操作记录</p><small>登录、保存配置、手动签到和自动任务都会记录在这里。</small></div>
        <div v-else class="log-timeline">
          <article v-for="entry in filteredOperations" :key="entry.id" class="log-entry">
            <div :class="['timeline-dot', entry.status]"></div>
            <div class="log-content">
              <div class="log-meta"><time>{{ formatLogTime(entry.occurredAt) }}</time><span :class="['source-badge', entry.source]">{{ sourceLabel(entry.source) }}</span><span :class="['result-badge', entry.status]">{{ operationStatusLabel(entry.status) }}</span></div>
              <h3>{{ entry.title }}</h3>
              <p v-if="entry.message">{{ entry.message }}</p>
              <small v-if="entry.exitCode !== undefined">核心退出码 {{ entry.exitCode }}</small>
            </div>
          </article>
        </div>
        <details v-if="rawLines.length" class="raw-logs"><summary>查看核心原始日志（已脱敏）</summary><pre>{{ rawLines.join('\n') }}</pre></details>
      </aside>
    </section>
  </main>

  <div v-if="qrAccount" class="modal-backdrop">
    <section class="modal qr-modal">
      <div class="modal-kicker">酷狗概念版</div><h2>{{ qrAccount.name }} · 扫码登录</h2>
      <div class="qr-frame"><img v-if="loginJob?.qrReady" :src="`/api/accounts/${qrAccount.id}/login/qr?t=${Date.now()}`" alt="酷狗概念版登录二维码" /><div v-else class="qr-loading"><span class="spinner"></span><p>二维码生成中…</p></div></div>
      <p :class="['job-state', loginJob?.state]">{{ loginJob?.message }}</p>
      <p class="modal-note">请使用酷狗概念版扫码并在手机上确认。成功、取消或过期后，二维码图片会自动删除。</p>
      <button v-if="!['success','failed','duplicate','cancelled'].includes(loginJob?.state || '')" class="button secondary full" @click="cancelLogin">取消登录</button>
      <button v-else class="button primary full" @click="closeQr">关闭</button>
    </section>
  </div>

  <div v-if="confirmDialog" class="modal-backdrop" @click.self="confirmDialog = null">
    <section :class="['modal', 'confirm-modal', { destructive: confirmDialog.kind === 'delete' }]">
      <div class="confirm-icon">{{ confirmDialog.kind === 'delete' ? '!' : 'i' }}</div>
      <p class="modal-kicker">{{ confirmDialog.account.name }}</p><h2>{{ confirmDialog.title }}</h2><p class="modal-note">{{ confirmDialog.message }}</p>
      <label v-if="confirmDialog.kind === 'delete'" class="delete-confirm">请输入账号名称 <strong>{{ confirmDialog.account.name }}</strong> 以确认<input v-model="deletePhrase" autocomplete="off" :placeholder="confirmDialog.account.name" /></label>
      <div class="modal-actions"><button class="button secondary" @click="confirmDialog = null">取消</button><button :class="['button', confirmDialog.kind === 'delete' ? 'danger' : 'primary']" :disabled="!canConfirm" @click="executeConfirm">{{ confirmDialog.confirmLabel }}</button></div>
    </section>
  </div>

  <div v-if="errorMessage" class="modal-backdrop" @click.self="errorMessage = ''">
    <section class="modal message-modal"><div class="confirm-icon error">!</div><p class="modal-kicker">OPERATION FAILED</p><h2>操作没有完成</h2><p class="modal-note">{{ errorMessage }}</p><button class="button primary full" @click="errorMessage = ''">我知道了</button></section>
  </div>
</template>
