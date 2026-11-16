<script setup lang="ts">
/** Staff sign-in. Same layout as the Beverly wallet admin: centred card over a soft aura, brand mark, labelled
 *  fields with a show/hide toggle, "remember email", and a restricted-access footer.
 *  Depends on: session store (login), roles (landing screen). */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useBrandMark } from '@/lib/use-brand-mark'
import { useSession } from '@/stores/session'
import { DEFAULT_SCREEN } from '@/lib/roles'

const REMEMBERED_EMAIL_KEY = 'beverly.call.remembered_email'

const session = useSession()
const router = useRouter()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberEmail = ref(true)
const error = ref('')
const busy = ref(false)
const mark = useBrandMark()

function remember(address: string): void {
  try { if (rememberEmail.value) localStorage.setItem(REMEMBERED_EMAIL_KEY, address); else localStorage.removeItem(REMEMBERED_EMAIL_KEY) } catch { /* storage blocked */ }
}

async function submit(): Promise<void> {
  const address = email.value.trim().toLowerCase()
  if (!address || !password.value) { error.value = 'Email and password are required.'; return }
  error.value = ''
  busy.value = true
  try {
    await session.login(address, password.value)
    remember(address)
    if (session.user) await router.replace(`/${DEFAULT_SCREEN[session.user.role]}`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Sign-in failed.'
  } finally {
    password.value = ''
    busy.value = false
  }
}

onMounted(() => {
  try {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY)
    if (saved) email.value = saved
    rememberEmail.value = Boolean(saved)
  } catch { /* storage blocked */ }
})
</script>

<template>
  <main class="login-stage">
    <div class="login-aura" aria-hidden="true"></div>
    <section class="c login-card" aria-labelledby="login-title">
      <div class="login-head">
        <img class="login-mark" :src="mark" alt="" width="52" height="52" />
        <h1 id="login-title" class="login-title">Beverly Call</h1>
        <p class="login-sub">Your Smart Power Partner.</p>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label class="fl">Email
          <input v-model.trim="email" type="email" autocomplete="username" placeholder="staff@acoblighting.com" required @input="error = ''" />
        </label>
        <label class="fl">Password
          <span class="password-field">
            <input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="Password" required @input="error = ''" />
            <button type="button" class="password-toggle" :aria-label="showPassword ? 'Hide password' : 'Show password'" @click="showPassword = !showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
          </span>
        </label>
        <label class="login-check"><input v-model="rememberEmail" type="checkbox" />Remember email</label>
        <div v-if="error" class="ban" role="alert" style="background: var(--danger-bg); color: var(--danger-fg)">{{ error }}</div>
        <button class="y login-submit" type="submit" :disabled="busy || !email || !password">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
      </form>

      <p class="login-foot">Access is restricted to Beverly staff. Contact your administrator.</p>
    </section>
  </main>
</template>

<style scoped>
.login-stage { position: relative; min-height: 100dvh; display: grid; place-items: center; padding: var(--sp-5) var(--sp-4); overflow: hidden; background: linear-gradient(135deg, var(--g1), var(--g2) 60%, var(--g3)); }
.login-aura { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(50% 40% at 50% 0%, color-mix(in srgb, var(--accent) 38%, transparent) 0%, transparent 70%), radial-gradient(40% 40% at 80% 100%, var(--orb2) 0%, transparent 65%); }
.login-card { position: relative; width: 100%; max-width: 420px; padding: var(--sp-5); border-radius: var(--r-xl); box-shadow: var(--sh-overlay); }
/* Theme aware: light/dark come from data-theme; in glass mode the card is a floating overlay using the --lg-* material tokens. */
:root[data-surf=glass] .login-card.login-card { background: linear-gradient(135deg, var(--lg-ovl-a), var(--lg-ovl-b)); border: 1px solid var(--lg-rim); box-shadow: var(--lg-spec), var(--lg-oshadow); -webkit-backdrop-filter: var(--lg-oblur); backdrop-filter: var(--lg-oblur); }
:root:not([data-surf=glass]) .login-card.login-card { background: var(--surface); border: 1px solid var(--border); }
.login-form input::placeholder { color: var(--text-muted); opacity: .8; }
.login-head { text-align: center; margin-bottom: var(--sp-5); }
.login-mark { display: block; margin: 0 auto var(--sp-3); object-fit: contain; }
.login-title { font-size: var(--fs-2xl); font-weight: var(--fw-light); margin: 0 0 6px; }
.login-sub { margin: 0; font-size: var(--fs-md); color: var(--text-muted); }
.login-form { display: grid; gap: var(--sp-3); }
.password-field { position: relative; display: block; }
.password-field input { padding-right: 76px; }
.password-toggle { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); height: 30px; min-width: 0; padding: 0 10px; background: transparent; color: var(--text); font-weight: var(--fw-medium); }
.login-check { display: inline-flex; align-items: center; gap: var(--sp-2); color: var(--text-muted); font-size: var(--fs-md); cursor: pointer; }
.login-check input { width: 18px; height: 18px; }
.login-submit { width: 100%; height: 46px; font-size: var(--fs-lg); }
.login-submit:disabled { opacity: .55; cursor: default; }
.login-foot { margin: var(--sp-5) 0 0; text-align: center; font-size: var(--fs-xs); color: var(--text-muted); }
</style>
